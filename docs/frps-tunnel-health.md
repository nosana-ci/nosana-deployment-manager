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
- **A job whose service never comes up is not acted on.** "Still starting" and "will never start" are indistinguishable from the outside, and a wrong teardown is worse than silence. This is deliberate — there is no time-based startup guessing anywhere in this feature.
- FRPS retains a down proxy's last events for **24h**; a DM outage longer than that could miss a death that occurred early in the outage window.

## Verifying after enablement

1. `frps_stream_connected` is 1 and `frps_events_total` is advancing.
2. Start an INFINITE deployment with an exposed port; confirm its `(job, opId)` rows appear `up` in `frps_endpoint_status`.
3. Kill frpc on a node (or `docker kill` in a test rig): expect `FRPS_TUNNEL_LOST`, then a stop + replacement ~60s later.
4. Stop and restart a tunnel within 60s: expect `FRPS_TUNNEL_RECOVERED` and no stop.
5. With a health-checked deployment, kill the backend only: expect `FRPS_TUNNEL_LOST`, the endpoint row `down/lost`, and a stop + replacement ~60s later — or `FRPS_TUNNEL_RECOVERED` and no stop if the backend restarts inside the grace.
