export const FRPSEventTypes = {
  CONNECTED: "connected",
  REGISTERED: "registered",
  UNREGISTERED: "unregistered",
} as const;

export type FRPSEventTypes = (typeof FRPSEventTypes)[keyof typeof FRPSEventTypes];

/**
 * Why a proxy was unregistered.
 *
 * `graceful` — frpc sent an explicit `msg.CloseProxy` shutting the proxy down
 *   cleanly (an op finished and the node stopped its frpc container).
 * `lost` — the control connection dropped without a goodbye: frpc or its host
 *   died. The workload is unreachable and won't come back on its own.
 * `unhealthy` — frpc is still connected but closed the proxy itself because the
 *   backend behind the tunnel failed its health check. The node is fine; the
 *   proxied service died (and may be restarting).
 *
 * Absent on an FRPS old enough to predate the distinction, in which case the
 * event tells us nothing and must not be acted on.
 */
export const FRPSCloseReasons = {
  GRACEFUL: "graceful",
  LOST: "lost",
  UNHEALTHY: "unhealthy",
} as const;

export type FRPSCloseReason = (typeof FRPSCloseReasons)[keyof typeof FRPSCloseReasons];

/**
 * Metadata frpc attaches to a proxy when the node opens the tunnel.
 *
 * This is the only way to tell WHICH replica an event belongs to: the endpoint
 * hostname is derived from `getExposeIdHash(deploymentHash, opId, 0)` (see
 * `createDeploymentRevisionEndpoints`) and is therefore identical across every
 * replica of a deployment, so `proxyName` alone can never identify the job.
 */
export interface FRPSEventMetaData {
  deploymentId: string;
  opId: string;
  jobId?: string;
}

interface FRPSEventBase {
  timestamp: number;
  proxyName: string;
  proxyType: "http";
  group?: string;
  /**
   * Sent either as one merged object or as several partial ones — parse it with
   * `parseFrpsMetadata` rather than reading index 0.
   */
  metadatas?: Array<Partial<FRPSEventMetaData>>;
}

export interface RegisteredEvent extends FRPSEventBase {
  type: typeof FRPSEventTypes.REGISTERED;
  domains?: string[];
  remoteAddr?: string;
}

export interface UnregisteredEvent extends FRPSEventBase {
  type: typeof FRPSEventTypes.UNREGISTERED;
  reason?: FRPSCloseReason;
}

/**
 * Sent once per connection, before the state snapshot (each proxy's last couple
 * of lifecycle events). Purely informational — the snapshot events that follow
 * arrive as ordinary registered/unregistered events.
 */
export interface ConnectedEvent {
  type: typeof FRPSEventTypes.CONNECTED;
  timestamp: number;
  message?: string;
}

export interface FRPSEvents {
  [FRPSEventTypes.CONNECTED]: ConnectedEvent;
  [FRPSEventTypes.REGISTERED]: RegisteredEvent;
  [FRPSEventTypes.UNREGISTERED]: UnregisteredEvent;
}
