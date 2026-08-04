import type { Collection } from "mongodb";

/**
 * Why a tunnel is currently down. Mirrors the FRPS SSE close reason
 * (`FRPSCloseReasons` in `src/listeners/frps/types.ts`) — kept as its own type
 * here so the persistence layer doesn't depend on the listener layer.
 */
export type FrpsTunnelReason = "graceful" | "lost";

export type FrpsEndpointState = "up" | "down";

/**
 * Resume point for the FRPS SSE stream. A single document (`_id = "frps"`)
 * holding the id of the last event DM processed, so a restart resumes via
 * `Last-Event-ID` instead of missing everything in between.
 */
export type FrpsStreamCursorDocument = {
  _id: string;
  last_event_id: string;
  updated_at: Date;
};

export type FrpsStreamCursorCollection = Collection<FrpsStreamCursorDocument>;

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
