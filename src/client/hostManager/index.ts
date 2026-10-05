import { getConfig } from "../../config/index.js";

import type { DeploymentRequirements } from "../../router/schema/components/requirements.schema.js";

/** How long one reservation request may take before it counts as "no response". */
const RESERVE_TIMEOUT_MS = 15_000;

/** Body of `POST /reservations`: queued nodes in `market`, narrowed by `requirements` when given. */
export type ReserveRequest = {
  market: string;
  requirements?: DeploymentRequirements;
  count: number;
  idempotencyKey: string;
};

/** Nodes held for the caller until `expiresAt`, each in the market it is queued in. */
export type ReserveResponse = {
  requested: number;
  reserved: number;
  /** ISO timestamp; null when nothing was reserved. */
  expiresAt: string | null;
  nodes: { nodeAddress: string; market: string }[];
};

/** A definitive HTTP error response from the host manager. */
export class HostManagerError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HostManagerError";
    this.status = status;
  }
}

/**
 * Reserve up to `count` queued nodes for direct assignment. Replaying the same
 * `idempotencyKey` returns the nodes already held under it. Throws
 * {@link HostManagerError} on an error response (409 key in flight, 422 bad
 * requirements, 503 chain unavailable, …) and the fetch error when no response
 * arrived (network, timeout, abort).
 */
export async function reserve(body: ReserveRequest, signal?: AbortSignal): Promise<ReserveResponse> {
  const { host_manager_url, host_manager_api_key } = getConfig();
  if (!host_manager_url) throw new Error("HOST_MANAGER_URL is not configured");
  if (!host_manager_api_key) throw new Error("HOST_MANAGER_API_KEY is not configured");

  const timeout = AbortSignal.timeout(RESERVE_TIMEOUT_MS);
  const response = await fetch(`${host_manager_url.replace(/\/$/, "")}/reservations`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: host_manager_api_key },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new HostManagerError(response.status, error?.message ?? response.statusText);
  }
  return response.json();
}
