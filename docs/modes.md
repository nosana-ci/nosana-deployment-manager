# Run modes

The deployment-manager runs as a single container image whose behaviour is selected at startup via the `APP_MODE` environment variable. One image, three modes, two Kubernetes deployments.

## Why the split

The service combines workloads with very different availability requirements:

- The Fastify HTTP API is user-facing. It must run as multiple replicas with rolling updates so a deploy or pod eviction does not take the API offline.
- The Mongo change-stream listeners (`deployments`, `jobs`), the Solana RPC monitor (`kit.jobs.monitor()`), and the task scheduler + `worker_threads` pool are **singletons**. A second replica would duplicate every change-stream event and cause the two pods to race on Solana monitor state. They can only run as one replica with the `Recreate` strategy.

Before the split, both lived in one Deployment, so every restart of the API took the listener side down too, and graceful shutdown was not implemented. After the split:

- `api` replicas can roll independently with zero downtime.
- the `worker` replica restarts cleanly with bounded in-flight task drain, change-stream closure, and an ordered shutdown.

## Modes

### `api`

Started:

- Fastify HTTP server (`src/router/index.ts`) on `DEPLOYMENT_MANAGER_PORT`.
- All HTTP routes: deployments, jobs, vaults, stats.
- `GET /health` (returns `{status, mode, timestamp}`).
- `GET /stats` (returns the local in-memory counters; in `api` mode jobs/tasks counters are zero because the API process never runs the work — see "/stats semantics" below).
- Swagger UI at `/documentation/swagger`.

Not started:

- Mongo change-stream listeners.
- Solana RPC monitor.
- Task scheduler / worker thread pool.
- Confidential job-definition IPFS pin (the API does not need it; only the worker does).

Kubernetes shape (per `apps/platform/k8s/helm-deployment-manager.tf`):

- `controllers.api` is the main controller; it gets the Service and Ingress.
- 2-3 replicas (HPA), `RollingUpdate` strategy.
- PDB: `maxUnavailable = 1`.
- Liveness probe: `httpGet /health` after 15 s, every 30 s.
- Readiness probe: `httpGet /health` after 5 s, every 10 s.
- ALB ingress healthcheck: `/health`.

### `worker`

Started:

- Mongo `deployments` change-stream listener (`src/listeners/deployments/index.ts`).
- Mongo `jobs` change-stream listener (`src/listeners/jobs/index.ts`).
- Solana account monitor (`src/listeners/accounts/index.ts`, via `kit.jobs.monitor()`).
- Task scheduler + `worker_threads` pool (`src/tasks/index.ts`): polls the `tasks` collection every 5 s, dispatches LIST/EXTEND/STOP work into worker threads, with a 120 s per-task timeout.
- Confidential job-definition IPFS pin (`src/index.ts` + `src/definitions/confidential.jobdefinition.ts`) — the resulting CID is set into the in-process config; spawned workers read it from there.
- Tiny health server (`src/health/server.ts`) on `DEPLOYMENT_MANAGER_PORT`, exposing:
  - `GET /health` — Kubernetes liveness probe.
  - `GET /stats` — the rich in-memory stats (in-flight tasks map, success/fail/timeout/avg-time counters).

Not started:

- The full Fastify API.

Why this is the singleton mode:

- A second replica running `collection.watch()` would receive every event a second time, so each in-process callback (strategy listeners) would fire twice.
- A second `kit.jobs.monitor()` would consume RPC traffic in parallel with no leader election or de-duplication.
- The task scheduler reads from a shared Mongo `tasks` collection, but it tracks in-flight work in an in-process `Map` — two replicas would both fetch the same task, both spawn a worker thread, and both attempt the same Solana transaction.

Until either resume-token-based change streams with leader election or a queue-broker fan-in is introduced, `worker` stays at 1 replica.

Kubernetes shape:

- `controllers.worker` (a non-main controller; no Service of its own — the cluster Service points only at the `api` controller).
- 1 replica, `Recreate` strategy.
- Liveness probe only: `httpGet /health` after 15 s, every 30 s. No readiness probe (there is nothing for traffic to be routed to).
- Inherits the same image and image tag as `api`.
- `APP_MODE=worker` env var; common env vars and the `deployment-manager-variable-secrets` secret are mounted via `envFrom`.

### `all`

Both `api` and `worker` are started in the same process. This is the default when `APP_MODE` is unset and is what `compose.yaml` uses for local development. Not used in Kubernetes.

## Startup order

In `src/index.ts`, mode-conditional:

1. `getAppMode()` parses `APP_MODE`, defaulting to `all`. Throws on invalid values (mirrors the blockchain-indexer pattern).
2. `initStats()` (always) — initialises the in-memory stats system.
3. If `shouldRunWorker(mode)`:
   - `initKit()` — creates the `NosanaClient`.
   - `kit.ipfs.pin(createConfidentialJobDefinition())` — pins the confidential job definition to IPFS and stores the CID in the in-process config so spawned workers can use it.
4. `createDeploymentsConnection()` — opens the MongoDB connection (used by both modes).
5. If `shouldRunWorker(mode)`:
   - `startDeploymentManagerListeners(db)` — starts the deployments + jobs change streams, the task scheduler, and the Solana account monitor. Returns `{ stop }`.
6. If `shouldRunApi(mode)`:
   - `startDeploymentManagerApi(db, mode)` — starts the Fastify HTTP server, returns the `FastifyInstance`.
7. Else if `shouldRunWorker(mode)`:
   - `startHealthServer(mode)` — starts the tiny worker-only HTTP server for `/health` + `/stats`.
8. Register the central `shutdown(signal)` handler on `SIGTERM` and `SIGINT`.

## Graceful shutdown

Centralised in `src/index.ts`. Both `SIGTERM` and `SIGINT` invoke the same handler. Any error during shutdown is logged but does not block the rest of the sequence; a hard timeout always wins.

Order:

1. Log `"shutting down gracefully"` and arm a `setTimeout(forceExit, 130_000)` that calls `process.exit(1)` if the rest of the sequence stalls. The timer is `unref`'d so it does not extend the event loop on its own. `130_000 ms = 120 s task drain budget + 10 s margin`.
2. **api**: `await apiServer.close()` — Fastify stops accepting new connections and waits for in-flight requests to finish.
3. **worker** (skipped if not running): `await listenersHandle.stop()`. Internally:
   - The task scheduler clears its 5 s polling interval immediately, so no new tasks are picked up.
   - The Solana RPC monitor receives `stop()`.
   - The scheduler then polls the in-flight `tasks` Map every 500 ms until either the Map empties or the 120 s deadline passes. Survivors are `worker.terminate()`-ed; their task documents stay in Mongo and are reclaimed on the next process's first poll. This is at-least-once semantics, identical to the existing `TIMEOUT` path that the task system has always tolerated.
   - Once the worker thread pool is drained, the deployments + jobs change streams are closed in parallel via `ChangeStream.close()`.
4. **worker without api**: `await healthServer.close()`.
5. `await closeDeploymentsConnection()` — closes the `MongoClient`.
6. Log `"shutdown complete"`, clear the force-exit timer, `process.exit(0)`.

What this guarantees vs the previous behaviour:

| Resource | Before | After |
|---|---|---|
| HTTP requests in flight | dropped | drained |
| `worker_threads` task | killed mid-flight | drained up to 120 s, then terminated and reclaimed |
| Mongo `ChangeStream`s | leaked | closed |
| `kit.jobs.monitor()` | leaked (only stopped on SIGINT, never SIGTERM) | stopped |
| `MongoClient` | leaked | closed |
| Signal handled | only `SIGINT` for the kit monitor | both `SIGTERM` (k8s) and `SIGINT` |

## `/stats` semantics

The `/stats` JSON shape is unchanged. The values reflect only what the local process knows:

- In `api` mode the API process never spawns task workers, so `tasks.in_progress`, `tasks.failed`, `tasks.successful`, `tasks.timed_out`, and the `jobs.*` counters are always 0. `started_at` and `running_ms` are useful.
- In `worker` mode the rich counters live on the worker pod. They are reachable via the worker's `/health` server `/stats` endpoint inside the cluster.
- In `all` mode (local dev) the counters work as they always have.

Cross-process unification (worker counters reachable from the api `/stats`) is tracked as a follow-up — see the plan file. The likely path is persisting counters into a `stats` collection in DocumentDB.

## Helm / Kubernetes

The Helm release lives at `apps/platform/k8s/helm-deployment-manager.tf` and uses `gitlab.com/nosana-ci/helm-template/k8s` v `2.0.1` (mirroring `client-manager` and `blockchain-indexer`). The single `helm_release` produces two Deployments via `additional_values.controllers`:

```hcl
main_controller_name = "api"
autoscaling = { enabled = true, min_replicas = 2, max_replicas = 3 }
pod_disruption_budget = { max_unavailable = 1 }

additional_values = {
  controllers = {
    api    = { ... probes: liveness + readiness on /health ... }
    worker = { type = "deployment", replicas = 1, strategy = "Recreate", env = [APP_MODE=worker, ...], probes: liveness only on /health }
  }
}
```

The pod security group is shared by both controllers.

## Local development

Default (`all` mode):

```bash
docker compose up -d
curl http://localhost:3001/health      # {"status":"healthy","mode":"all","timestamp":"..."}
curl http://localhost:3001/stats
```

Single-mode:

```bash
APP_MODE=api docker compose up -d deployment_manager
APP_MODE=worker docker compose up -d deployment_manager
```

Send SIGTERM and watch the shutdown sequence:

```bash
docker compose exec -T deployment_manager kill -TERM 1
docker compose logs deployment_manager --tail=50
```

You should see, in order: `shutting down gracefully`, `stopped api server` (if `api`/`all`), `stopped task scheduling`, `closed change streams` (if `worker`/`all`), `shutdown complete`.

## Tests

Unit tests (run via `npm test`):

- `src/config/mode.test.ts` — `getAppMode()` parser and `shouldRunApi`/`shouldRunWorker` predicates.
- `src/client/listener/index.test.ts` — `createCollectionListener`'s `start()`/`stop()` contract: events are delivered, `stop()` closes the underlying `ChangeStream`, the async iterator exits cleanly.
- `src/tasks/index.test.ts` — `startTaskCollectionListener.stop()` clears the polling interval and resolves cleanly with no in-flight workers, and the drain-budget constants are exported.

Scenario tests (run via `npm run test:scenarios`, requires Docker for the shutdown flow and a devnet wallet for the others):

- `testing/scenario/scenarios/shutdown.test.ts` — brings up `compose.yaml`, hits `/health`, sends `SIGTERM` to PID 1, asserts the shutdown log lines, restarts, hits `/health` again. Mirrors `apps/platform/blockchain-indexer/tests/scenario/scenarios/shutdown.test.ts`.
- The other scenarios (`endpoints.test.ts`, `errors.test.ts`, `simple.test.ts`, `simple-extend.test.ts`, `scheduled.test.ts`) hit a devnet `BACKEND_URL` and are unchanged.

## Operational FAQ

**Why does a `worker` rollout cause a brief gap in change-stream processing?**
The `worker` deployment uses `Recreate` (it must — see the singleton rationale). During a rollout, the old pod terminates fully (≤ 130 s graceful shutdown) before the new pod starts, so there is a window where no pod is consuming the change streams. Kubernetes flushes the events to the new pod's `watch()` cursor on startup, so no events are lost. The `api` controller is unaffected: it rolls independently with `RollingUpdate` and 2-3 replicas.

**What happens to in-flight tasks when the worker pod restarts?**
The shutdown handler waits up to 120 s for the in-process `tasks` Map to drain. Any task that does not finish in that window is `worker.terminate()`-ed; its document is left in the `tasks` collection. The next worker pod fetches outstanding tasks via `getOutstandingTasks` on its first poll (within 5 s of startup) and re-spawns them. This is at-least-once semantics — the same guarantee the existing per-task 120 s timeout already provided.

**Can I run two `worker` replicas?**
No. Both Mongo change streams and the Solana monitor would fire duplicate events, and the in-process task `Map` is not shared across pods so both replicas would race to spawn workers for the same task. The Helm chart hard-codes `replicas = 1` and `strategy = "Recreate"`. Lifting this would require either a leader-election layer (e.g. via Mongo) or a queue broker that fans events into a shared work queue.

**The ALB healthcheck used to point at `/stats`. Why move it to `/health`?**
`/health` is mode-aware (returns `{status, mode, timestamp}`) and exists in both modes; `/stats` returns business counters that are zero in `api` mode and would be a misleading liveness signal. The other two services (`client-manager`, `blockchain-indexer`) already use `/health` for the same reason.

**Can I deploy this to dev and prd at the same image tag?**
Yes — `apps/platform/k8s/helm-deployment-manager.tf` already pins `image_tag = { dev = "v1.0.114", prd = "v1.0.114" }`. Bump that to the next tag once the new image is built and pushed.
