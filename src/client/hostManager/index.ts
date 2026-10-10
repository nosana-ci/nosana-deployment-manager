import { getConfig } from "../../config/index.js";

import type { DeploymentRequirements } from "../../router/schema/components/requirements.schema.js";

/** How long one reservation request may take before it counts as "no response". */
const RESERVE_TIMEOUT_MS = 15_000;

/** A definitive HTTP error response from the host manager. */
export class HostManagerError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HostManagerError";
    this.status = status;
  }
}

/** Body of `POST /reservations/requests`: registers a request for `count` nodes, or renews the one under `key`. */
export type ReservationRequestBody = {
  key: string;
  market: string;
  requirements?: DeploymentRequirements;
  count: number;
  /** How long a waiting request stays queued without a renewal (host-manager caps it at 900). */
  ttlSeconds?: number;
};

/**
 * host-manager's view of a request. Only a `fulfilled` request carries nodes,
 * held for us until `holdExpiresAt`; a `waiting` one stays queued until
 * `expiresAt` unless renewed.
 */
export type ReservationRequestResponse = {
  key: string;
  status: "waiting" | "fulfilled" | "cancelled" | "expired";
  requested: number;
  nodes: { nodeAddress: string; market: string }[];
  /** ISO timestamp; null unless fulfilled. */
  holdExpiresAt: string | null;
  /** ISO timestamp of the request's TTL. */
  expiresAt: string;
};

/** What a cancelled request ended as, and how many held nodes were released. */
export type CancelReservationRequestResponse = {
  key: string;
  status: "cancelled" | "fulfilled" | "expired";
  released: number;
};

/**
 * Register a reservation request, or renew the one already under `key`.
 * host-manager fills it at once when it can, otherwise queues it and calls our
 * webhook when matching nodes appear; the same key replays a fulfilment.
 * Throws {@link HostManagerError} on an error response (409 key reused with
 * other terms, 422 bad requirements, 404 unknown market, 503 chain unavailable,
 * …) and the fetch error when no response arrived (network, timeout, abort).
 */
export function requestReservation(
  body: ReservationRequestBody,
  signal?: AbortSignal
): Promise<ReservationRequestResponse> {
  return callHostManager("POST", "/reservations/requests", body, signal);
}

/**
 * Cancel the request under `key` and release any nodes still held under it.
 * Idempotent: an unknown or already-cancelled key succeeds too.
 */
export function cancelReservationRequest(key: string): Promise<CancelReservationRequestResponse> {
  return callHostManager("DELETE", `/reservations/requests/${encodeURIComponent(key)}`);
}

async function callHostManager<T>(
  method: "POST" | "DELETE",
  path: string,
  body?: unknown,
  signal?: AbortSignal
): Promise<T> {
  const { host_manager_url, host_manager_api_key } = getConfig();
  if (!host_manager_url) throw new Error("HOST_MANAGER_URL is not configured");
  if (!host_manager_api_key) throw new Error("HOST_MANAGER_API_KEY is not configured");

  const timeout = AbortSignal.timeout(RESERVE_TIMEOUT_MS);
  const response = await fetch(`${host_manager_url.replace(/\/$/, "")}${path}`, {
    method,
    headers: {
      ...(body !== undefined && { "content-type": "application/json" }),
      authorization: host_manager_api_key,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new HostManagerError(response.status, error?.message ?? response.statusText);
  }
  return response.json();
}
