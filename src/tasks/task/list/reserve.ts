import { ObjectId, type Filter } from "mongodb";

import {
  HostManagerError,
  requestReservation,
  type ReservationRequestResponse,
} from "../../../client/hostManager/index.js";
import { getConfig } from "../../../config/index.js";
import { messageOf } from "../../idempotency/errorInfo.js";
import { TaskStatus, TaskType } from "../../../types/index.js";

import type { DeploymentRequirements } from "../../../router/schema/components/requirements.schema.js";
import type {
  EventsCollection,
  OutstandingTasksDocument,
  ReservedNode,
  TaskDocument,
  TaskReservation,
  TaskReservationRequest,
  TasksCollection,
} from "../../../types/index.js";

/** Host-manager's per-request cap on `count`; the rest is handed to a new LIST task. */
const MAX_RESERVATION_COUNT = 50;

/** Host-manager's cap on a request's TTL. */
const MAX_REQUEST_TTL_SECONDS = 900;

/**
 * Outcome of the reserve step of a LIST attempt. A LIST task makes one
 * reservation request, keyed by its id; what it cannot get from it is handed to
 * a new LIST task.
 *   - reserved    — `nodes` (at least one) are held for this task, to assign now;
 *                   fewer than asked for is a shortfall the run hands off afterwards.
 *   - waiting     — host-manager queued the request (recorded on the task): park
 *                   until the webhook fills it or it is due for renewal.
 *   - handoff     — the request has nothing (more) for this task: its fill is used
 *                   or lapsed, it expired or was cancelled, or host-manager
 *                   refused the deployment's new terms under the old key (409).
 *                   `backoff` unless the terms changed, so a chain of empty
 *                   hand-offs cannot spin.
 *   - retry       — 5xx / no response: retry the same key after the cooldown.
 *   - fatal       — the deployment's market/requirements are rejected (422, 404).
 */
export type ReserveOutcome =
  | { kind: "reserved"; reservation: TaskReservation; nodes: ReservedNode[] }
  | { kind: "waiting" }
  | { kind: "handoff"; backoff: boolean }
  | { kind: "retry"; error: string }
  | { kind: "fatal"; error: string };

/**
 * What a request is sent with: always the deployment's current terms. While a
 * request is pending nothing was assigned, so its count is unchanged; a market or
 * requirements change makes host-manager answer 409 for the old key.
 */
type RequestTerms = { market: string; requirements: DeploymentRequirements | null; count: number };

/**
 * Reserve nodes for `count` jobs and persist them on the task before anything is
 * signed.
 *
 * A task that already holds its fill (a reclaim, or the webhook delivered it)
 * reuses the nodes still held, unused and in the deployment's current market; a
 * node on any TxRecord was used by a prior attempt and is never handed to the
 * signer again. Otherwise the task's request is renewed, or recorded and then
 * sent, on the deployment's current terms. A failed request stays recorded, so
 * the next attempt re-sends the same key and host-manager replays it if the lost
 * request landed.
 */
export async function reserveListNodes(
  tasks: TasksCollection,
  events: EventsCollection,
  task: OutstandingTasksDocument,
  count: number,
  signal: AbortSignal
): Promise<ReserveOutcome> {
  if (task.reservation) return reuseReservation(task, task.reservation, count);

  const terms: RequestTerms = {
    market: task.deployment.market,
    requirements: task.deployment.requirements ?? null,
    count: Math.min(count, MAX_RESERVATION_COUNT),
  };
  const pending = task.reservation_request;
  // A new request is recorded BEFORE it is sent, so its webhook always finds it.
  if (!pending) await tasks.updateOne({ _id: task._id }, { $set: { reservation_request: {} } });
  return submitRequest(tasks, events, task, terms, pending ?? {}, signal);
}

function reuseReservation(task: OutstandingTasksDocument, reservation: TaskReservation, count: number): ReserveOutcome {
  const { market } = task.deployment;
  const used = new Set((task.transactions ?? []).flatMap((record) => record.nodes ?? []));
  const nodes = reservation.nodes.filter((reserved) => !used.has(reserved.node) && reserved.market === market);
  if (isLive(reservation) && nodes.length > 0) return { kind: "reserved", reservation, nodes: nodes.slice(0, count) };
  return { kind: "handoff", backoff: reservation.nodes.every((reserved) => reserved.market === market) };
}

/**
 * Send (or renew) the task's request: a fill with a live hold becomes the
 * task's reservation, a `waiting` answer is noted once, and anything else (a
 * replayed fill whose hold lapsed, expired, cancelled, or a 409 for changed
 * terms) is a hand-off. The TTL
 * outlives the renewal interval by a minute, so a parked request never lapses
 * between renewals.
 */
async function submitRequest(
  tasks: TasksCollection,
  events: EventsCollection,
  task: OutstandingTasksDocument,
  terms: RequestTerms,
  request: TaskReservationRequest,
  signal: AbortSignal
): Promise<ReserveOutcome> {
  const response = await requestReservation(
    {
      key: task._id.toHexString(),
      market: terms.market,
      ...(terms.requirements && { requirements: terms.requirements }),
      count: terms.count,
      ttlSeconds: Math.min(MAX_REQUEST_TTL_SECONDS, Math.ceil(getConfig().reservation_renew_ms / 1000) + 60),
    },
    signal
  ).catch(reservationFailure);
  if ("kind" in response) return response;

  if (response.status === "waiting") {
    await noteWaiting(tasks, events, task, terms, request);
    return { kind: "waiting" };
  }
  const reservation = toReservation(response);
  // Never expected, but a fill without nodes is nothing to assign either.
  if (response.status !== "fulfilled" || !isLive(reservation) || reservation.nodes.length === 0) {
    return { kind: "handoff", backoff: true };
  }

  await tasks.updateOne({ _id: task._id }, { $set: { reservation }, $unset: { reservation_request: "" } });
  const markets = [...new Set(reservation.nodes.map((node) => node.market))];
  await events.insertOne({
    deploymentId: task.deploymentId,
    category: "Deployment",
    type: "JOB_RESERVE_CONFIRMED",
    message: `Reserved ${reservation.nodes.length} node(s) in market(s) ${markets.join(", ")}`,
    created_at: new Date(),
  });
  return { kind: "reserved", reservation, nodes: reservation.nodes };
}

/**
 * Stamp when host-manager first queued the request, and say so once per request
 * (not per renewal). An INFINITE rotation (`job` set) waiting is no capacity
 * problem: the job it replaces keeps running, and its node frees up at the
 * latest when that job ends.
 */
async function noteWaiting(
  tasks: TasksCollection,
  events: EventsCollection,
  task: OutstandingTasksDocument,
  terms: RequestTerms,
  request: TaskReservationRequest
): Promise<void> {
  if (request.since) return;
  await tasks.updateOne(
    { _id: task._id, reservation_request: { $exists: true } },
    { $set: { "reservation_request.since": new Date() } }
  );
  await events.insertOne({
    deploymentId: task.deploymentId,
    category: "Deployment",
    type: "JOB_RESERVE_WAITING",
    message: task.job
      ? `Rotation of job ${task.job}: no spare node yet, it is replaced as soon as one frees up (at the latest when the job ends)`
      : `Waiting for ${terms.count} matching node(s) in market ${terms.market}`,
    created_at: new Date(),
  });
}

function toReservation({ nodes, holdExpiresAt }: Pick<ReservationRequestResponse, "nodes" | "holdExpiresAt">): TaskReservation {
  return {
    expiresAt: holdExpiresAt ? new Date(holdExpiresAt) : null,
    nodes: nodes.map(({ nodeAddress, market }) => ({ node: nodeAddress, market })),
  };
}

/**
 * A 409 means the deployment's terms changed under a pending request: a new task
 * asks on them at once. Any other 4xx (422 bad requirements, 404 unknown market)
 * means the deployment itself is wrong, so retrying cannot help. A 5xx or no
 * response at all may be a lost success: the same key is re-sent after the
 * cooldown.
 */
function reservationFailure(error: unknown): Extract<ReserveOutcome, { kind: "handoff" | "retry" | "fatal" }> {
  if (!(error instanceof HostManagerError) || error.status >= 500) {
    return { kind: "retry", error: `Node reservation failed: ${messageOf(error)}` };
  }
  if (error.status === 409) return { kind: "handoff", backoff: false };
  return { kind: "fatal", error: `Node reservation rejected: ${messageOf(error)}` };
}

function isLive({ expiresAt }: TaskReservation): boolean {
  return expiresAt !== null && expiresAt.getTime() > Date.now();
}

// ---------------------------------------------------------------------------
// Webhook: host-manager filled a waiting request
// ---------------------------------------------------------------------------

/** A fulfilment as host-manager's webhook delivers it; `key` is the LIST task's id. */
export type RequestFulfilment = Pick<ReservationRequestResponse, "key" | "nodes"> & { holdExpiresAt: string };

/**
 * Persist a webhook's fill as the task's reservation and make the task due now,
 * so the LIST worker assigns the nodes within their hold. True when the task
 * holds the nodes: recorded now, or already (a redelivery). False when the task
 * is gone or has no request: the caller releases the nodes. A parked task is
 * PENDING already; one mid-run is released due now when it tries to park (see
 * `parkTask`).
 */
export async function recordRequestFulfilment(tasks: TasksCollection, fulfilment: RequestFulfilment): Promise<boolean> {
  if (!/^[0-9a-f]{24}$/.test(fulfilment.key)) return false;
  const _id = new ObjectId(fulfilment.key);

  const { matchedCount } = await tasks.updateOne(
    { _id, reservation_request: { $exists: true } },
    { $set: { reservation: toReservation(fulfilment), due_at: new Date() }, $unset: { reservation_request: "" } }
  );
  if (matchedCount > 0) return true;

  const task = await tasks.findOne({ _id }, { projection: { reservation: 1 } });
  return Boolean(task?.reservation);
}

/**
 * Make parked LIST tasks (those waiting on a request) due now, so they renew it
 * at once: on API start, because host-manager sends each webhook once and a fill
 * made while the API was down is missed; and when a deployment's terms change
 * (narrowed by `filter`), so its LISTs hand off to the new terms. Never throws.
 */
export async function resyncParkedListTasks(tasks: TasksCollection, filter: Filter<TaskDocument> = {}): Promise<void> {
  try {
    await tasks.updateMany(
      { ...filter, task: TaskType.LIST, status: TaskStatus.PENDING, reservation_request: { $exists: true } },
      { $set: { due_at: new Date() } }
    );
  } catch (error) {
    console.error("[reservations] failed to resync parked LIST tasks", error);
  }
}
