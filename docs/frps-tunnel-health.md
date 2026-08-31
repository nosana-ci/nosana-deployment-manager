# FRPS Tunnel-Health Watching

**Deployment Manager release — `frps-watching`**

The deployment manager now watches FRPS — the reverse proxy that fronts every deployment endpoint — as an out-of-band liveness signal. When a job becomes unreachable — whether the node died or the backend service behind a healthy tunnel did — the job is stopped and automatically replaced. Clean shutdowns (an op finishing) are recognised and ignored.

---

## The problem

On-chain job state does not reflect network reachability. A job can sit on-chain `RUNNING` while its workload is unreachable — the node died, frpc lost its connection, or the container wedged without closing the job. Until now the deployment reported healthy, the user's endpoint returned 502s, no replacement was posted, and the user paid for a phantom replica until the job timed out.

FRPS terminates every deployment endpoint, so it knows the truth first. This release consumes that signal.

## How it works

DM (in the `listeners` role, singleton) subscribes to the FRPS connection event stream over SSE. FRPS emits lifecycle events per proxy — `registered` / `unregistered` — where each `unregistered` carries a **reason**:

| Reason | What actually happened | DM reaction |
|---|---|---|
| `lost` | The workload is unreachable: frpc/the node died (control connection dropped), **or** the backend service failed its health check while frpc stayed connected — FRPS reports both as `lost`, since either way the service is down and not by choice | Schedule a **grace-delayed stop** (default 60s). If the tunnel re-registers inside the grace — an frpc reconnect or the backend restarting via its container restart policy — the stop is cancelled. Otherwise the job stops and the infinite strategy posts a replacement. |
| `graceful` | frpc shut the proxy down cleanly — an op finished and the node stopped its sidecar | Ignored. Each op runs its own frpc container, so proxies legitimately vanish mid-job at op transitions. |
| *(absent)* | Event from an FRPS predating the reason field | Ignored — carries no usable fault signal. |

Key mechanics:

- **Grace + cancel, not instant kills.** A `lost` stop is scheduled `FRPS_UNHEALTHY_GRACE_MS` in the future as a durable task; a matching `registered` within the window deletes it. The grace lives in the task, not memory, so a DM restart mid-window still stops the job. The delete cannot race the task consumer (it only matches tasks not yet due).
- **Stateless resync.** On every (re)connect, FRPS sends a snapshot of each proxy's last two lifecycle events. DM derives current state entirely from that — there is no cursor, no replay, nothing persisted about the stream. Missing events while disconnected changes nothing: only a proxy's latest state matters, and the snapshot always carries it.
- **Replacement is the existing path.** A stopped job flows through the on-chain `COMPLETED/STOPPED` listener, which tops the deployment back up. This feature only decides *when to stop*; it adds no new replacement logic.
- **Events are processed in order and idempotently**, so snapshot/live duplicates and replays are harmless.

## What ships in DM

**Configuration** (all optional; the feature is inert until the address is set):

| Env var | Default | Purpose |
|---|---|---|
| `FRPS_INTERNAL_ADDRESS` | *(empty — disabled)* | Cluster-internal FRPS base URL **including scheme and port**, e.g. `http://frps.frps.svc.cluster.local:7501` (or `https://…` for TLS). A bare `host:port` is rejected at startup. Empty disables watching entirely. |
| `FRPS_API_KEY` | — | The FRPS `proxyAPIServer` API key (its `ADMIN_KEY`), sent as `X-API-Key`. |
| `FRPS_WATCHING_ENABLED` | `true` | Kill-switch. Set `false` to disable without unsetting the address. |
| `FRPS_UNHEALTHY_GRACE_MS` | `60000` | Grace between a `lost` teardown and the stop; a re-register inside it cancels. |

`FRPS_ADDRESS` (public endpoint hostname) is unchanged; internally the config field was renamed to `frps_public_address` to distinguish it from the new internal address.

**New collection — `frps_endpoint_status`.** One document per `(job, opId)`: `state: up|down`, `reason: lost|graceful`, `last_change`. Written from every lifecycle event, including graceful ones — queryable op-level tunnel truth for the dashboard. Migration `17` adds the unique `(job, opId)` index.

**Deployment events** (user-visible in the existing events feed):

- `FRPS_TUNNEL_LOST` — job unreachable; it will be stopped and replaced in *N*s unless it recovers.
- `FRPS_TUNNEL_RECOVERED` — tunnel came back inside the grace; pending stop cancelled.

**Metrics** (listeners-role registry):

- `frps_stream_connected` (gauge, 0/1) — **alert on this**; a silently dead stream is the main failure mode.
- `frps_events_total{type}`
- `frps_unhealthy_jobs_total{outcome}` — `scheduled` / `cancelled` / `skipped` / `stale_event`.

## Rollout order — this matters

The feature depends on the FRPS/frpc release carrying reason-tagged events (`feat/conn-event-reasons-replay`). The order is:

1. **Deploy the new FRPS.** Fully backward compatible with old frpc — safe to ship first.
2. **Roll the new frpc image across the node fleet.** Old frpc exits on SIGTERM without a goodbye, so with old frpc **every clean stop reports `lost`**, and a dead backend reports `graceful` — both inverted from the truth.
3. **Only then enable DM watching** (set `FRPS_INTERNAL_ADDRESS` + `FRPS_API_KEY`).

> ⚠️ Enabling DM watching while old frpc images are still in the fleet is unsafe: every op transition on a multi-op job would emit `lost`, and if the next op's image pull outlasts the 60s grace, DM would stop a healthy job. The frpc rollout must complete first.

DM itself can be deployed at any point in this sequence — it does nothing until the address is configured, and the kill-switch turns it off instantly if needed.

## Scope and known limitations

- **INFINITE deployments only**, in `RUNNING` state. Other strategies have no replacement logic to hang a reaction on.
- **HTTP proxies only.** Job identity comes from the frpc metadata on the deployment (`-dp`) proxy. SSH `tcpmux` and RA-TLS `https` proxies emit no lifecycle events yet.
- **Detecting a dead backend requires a health check.** frpc only probes the backend when the job definition declares an HTTP health check (`type: http`, `GET`, expected 200). With one, a dead backend is reported as `lost` and handled like any other unreachability; without one, a dead backend behind a live tunnel produces no signal at all.
- **A job whose service never comes up is acted on only when the owner asks for it.** "Still starting" and "will never start" are indistinguishable from the outside, so DM never guesses: it acts only on the deadline an owner sets explicitly (`startup_timeout`, below). Without one, a job that never opens its tunnel is left alone.
- FRPS retains a down proxy's last events for **24h**; a DM outage longer than that could miss a death that occurred early in the outage window.

## Startup timeout (INFINITE, opt-in)

`startup_timeout` — minutes, set at deployment creation or later via `PATCH /deployments/:deployment/update-startup-timeout` — is how long a job has to open its tunnel, measured from the moment a node starts running it. A change applies to jobs started after it, since `armStartupDeadline` reads the field only when a job reaches `RUNNING`. It reuses the machinery above rather than adding a worker:

1. The job reaches `RUNNING`: `armStartupDeadline` schedules a STOP targeting that job, `due_at` = now + `startup_timeout`, and stamps the same date on the job as `startup_deadline`.
2. The tunnel registers: `frpsRegisterHandler` deletes the pending STOP and clears the marker. Nothing is logged — coming up in time is the normal path.
3. The tunnel never registers: the STOP falls due, the job is stopped, and `infiniteJobStateCompletedOrStopUpdate` replaces it on another node.

The task's `due_at` **is** the deadline, so it survives a listener restart, and the register-side cancel is the same delete that retires an unhealthy-tunnel grace stop.

Notes:

- The clock starts at `RUNNING`, which is only where a node *claimed* the job — the image pull and any ops preceding the exposed one happen inside the window. Set it generously.
- A job stopped for missing its deadline feeds the **rapid-completion streak**, so a definition that can never come online (wrong port, image that won't boot, timeout shorter than the pull) backs off with an escalating cooldown and stops the deployment at `RAPID_COMPLETION_MAX_STREAK` instead of rotating nodes forever. Events: `STARTUP_TIMEOUT_THROTTLE`, `STARTUP_TIMEOUT_FAIL_SAFE`.
- Creation rejects `startup_timeout` on a definition that exposes no ports — nothing could ever report such a job online, so every job would rotate.
- A tunnel that registers *after* the deadline has passed does not undo the stop: the job was late, and a deployment that is consistently late still needs to escalate.

## Deployment endpoint status

`GET /deployments/:id` and the deployment list return each endpoint with `online`,
and the SSE stream carries one `endpoint` frame per endpoint — the endpoint itself
(`opId`, `port`, `url`, `online`), the same shape those routes return, so a client
needs nothing else to render it.

An endpoint is online when **some job of the deployment has that op's tunnel up
AND is still RUNNING on chain**. Both halves matter:

- The FRPS half is the reachability signal. No health check is involved — a
  registered tunnel is the whole test.
- The on-chain half is what retires an endpoint. `frps_endpoint_status` rows are
  never deleted, so a row can outlive its job (an FRPS outage longer than its 24h
  event retention leaves nothing in the reconnect snapshot to correct it). Job
  state is authoritative for whether the workload still exists.

The value is stored on the deployment's own `endpoints`, so a read is just the
deployment. `refreshDeploymentEndpointStatus` maintains it from the listeners that
see it move: a tunnel registering, a tunnel dropping, and a job state change
(`jobEndpointStatusUpdate`, every strategy). Each recomputes from source rather
than toggling, so a missed trigger — a listener restart, an FRPS event that never
arrived — is corrected by the next one instead of persisting a wrong answer.

Only endpoints that actually moved are written, through `arrayFilters` on `opId`
rather than `$set`ting the array, so a concurrent write to the deployment cannot
be clobbered by a stale copy read moments earlier.

Backfilled by `18-migrateEndpointsToOnline`, which is required rather than
cosmetic: the response schema makes `online` mandatory, so a deployment written
before the field existed fails serialization and the read routes answer 500. The
migration computes the real value by the same rule the listeners use, so a
deployment that is serving does not read offline until its next event, and only
fills endpoints where the field is absent.

Two things it must not disturb, both guarded:

- **`updated_at` is never bumped.** It marks configuration changes, and
  `infiniteJobStateCompletedOrStopUpdate` selects recent jobs with
  `created_at >= deployment.updated_at` — a tunnel flap moving it would quietly
  break the rapid-completion fail-safe.
- **A revision rebuilds `endpoints` wholesale**, so they start offline. That is
  left to converge rather than carried across: the new revision's ops may differ,
  and a revision change always schedules a STOP for the old revision and a LIST
  for the new, so the job state changes that follow put reachability back to the
  truth.

Status is per `opId`, so several ports exposed by one op always report together.
That is a node-side property, not an FRPS one: `deployment_endpoint` is derived as
`getExposeIdHash(deploymentHash, opId, 0)` with the port pinned to 0, so an op's
ports share one deployment hostname and one load-balanced proxy. (frpc does
register a proxy per port — the job-level URLs beside these are already per port.)
Deriving that hostname per port is a node change; when it lands, tunnel status
needs a port key here and the port on the FRPS event, since only `registered`
carries `domains`.

On the stream, the opening snapshot states every endpoint straight off the
deployment. After that, an `endpoints` change restates them all — the change event
carries the whole document, not a diff. One replica flapping while another still
serves the endpoint writes nothing, and so emits nothing.

With FRPS watching disabled (`FRPS_WATCHING_ENABLED=false` or no
`FRPS_INTERNAL_ADDRESS`) nothing writes tunnel status, so every endpoint reports
`online: false`.

## Verifying after enablement

1. `frps_stream_connected` is 1 and `frps_events_total` is advancing.
2. Start an INFINITE deployment with an exposed port; confirm its `(job, opId)` rows appear `up` in `frps_endpoint_status`.
3. Kill frpc on a node (or `docker kill` in a test rig): expect `FRPS_TUNNEL_LOST`, then a stop + replacement ~60s later.
4. Stop and restart a tunnel within 60s: expect `FRPS_TUNNEL_RECOVERED` and no stop.
5. With a health-checked deployment, kill the backend only: expect `FRPS_TUNNEL_LOST`, the endpoint row `down/lost`, and a stop + replacement ~60s later — or `FRPS_TUNNEL_RECOVERED` and no stop if the backend restarts inside the grace.
