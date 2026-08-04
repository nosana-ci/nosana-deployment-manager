export const FRPSEventTypes = {
  CONNECTED: "connected",
  REGISTERED: "registered",
  UNREGISTERED: "unregistered",
} as const;

export type FRPSEventTypes = (typeof FRPSEventTypes)[keyof typeof FRPSEventTypes];

/**
 * Why a proxy was unregistered.
 *
 * `graceful` means frpc sent an explicit `msg.CloseProxy` — it shut down
 * cleanly, which is what happens when an op finishes and the node stops its
 * frpc container. `lost` means the control connection dropped without a
 * goodbye: frpc or its host died. Only `lost` indicates an unhealthy workload.
 *
 * Absent on an FRPS old enough to predate the distinction, in which case the
 * event tells us nothing and must not be acted on.
 */
export const FRPSCloseReasons = {
  GRACEFUL: "graceful",
  LOST: "lost",
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
 * Sent once per connection. `gap` is true when our `Last-Event-ID` could not be
 * replayed (first connect, evicted from the ring, or the server counter reset),
 * meaning we must re-baseline from a snapshot rather than trust the event log.
 */
export interface ConnectedEvent {
  type: typeof FRPSEventTypes.CONNECTED;
  timestamp: number;
  message?: string;
  gap: boolean;
  newestId?: string;
}

export interface FRPSEvents {
  [FRPSEventTypes.CONNECTED]: ConnectedEvent;
  [FRPSEventTypes.REGISTERED]: RegisteredEvent;
  [FRPSEventTypes.UNREGISTERED]: UnregisteredEvent;
}
