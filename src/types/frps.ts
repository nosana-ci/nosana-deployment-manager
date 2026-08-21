import type { Collection } from "mongodb";

/**
 * Why a tunnel is currently down. Mirrors the FRPS SSE close reason
 * (`FRPSCloseReasons` in `src/listeners/frps/types.ts`) — kept as its own type
 * here so the persistence layer doesn't depend on the listener layer.
 *
 * `graceful` — frpc shut the proxy down cleanly (op finished).
 * `lost`     — the workload is unreachable: frpc/the node died, or frpc reported
 *              the backend failed its health check. FRPS collapses both to one
 *              reason, since both warrant the same reaction.
 */
export type FrpsTunnelReason = "graceful" | "lost";

export type FrpsEndpointState = "up" | "down";

/**
 * Per-`(job, opId)` tunnel status, driven entirely by the FRPS event stream.
 * The queryable op-level source of truth for tunnel health.
 */
export type FrpsEndpointStatusDocument = {
  job: string;
  opId: string;
  deploymentId: string | undefined;
  state: FrpsEndpointState;
  /** Set when `state` is `down`; distinguishes a clean shutdown from a fault. */
  reason?: FrpsTunnelReason;
  /** When `state` last changed. */
  last_change: Date;
  updated_at: Date;
};

export type FrpsEndpointStatusCollection = Collection<FrpsEndpointStatusDocument>;
