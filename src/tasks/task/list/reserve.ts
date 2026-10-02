import { reserve } from "../../../client/hostManager/index.js";
import { buildIdempotencyKey, classifyReservationError } from "../../idempotency/index.js";
import { messageOf } from "../../idempotency/errorInfo.js";

import type {
  EventsCollection,
  OutstandingTasksDocument,
  ReservedNode,
  TaskReservation,
  TasksCollection,
} from "../../../types/index.js";

/** Host-manager's per-request cap on `count`; a larger shortfall reconciles over attempts. */
const MAX_RESERVATION_COUNT = 50;

/**
 * Outcome of the reserve step of a LIST attempt.
 *   - reserved    — `nodes` (possibly empty) are the reserved nodes to assign now;
 *                   fewer than requested is a shortfall (event already emitted).
 *   - in-progress — the same key is still in flight at host-manager (409).
 *   - retry       — 5xx / no response: retry the same key after the cooldown.
 *   - fatal       — the deployment's market/requirements are rejected (422, 404).
 */
export type ReserveOutcome =
  | { kind: "reserved"; reservation: TaskReservation; nodes: ReservedNode[] }
  | { kind: "in-progress" }
  | { kind: "retry"; error: string }
  | { kind: "fatal"; error: string };

/**
 * Reserve nodes for `count` jobs and persist the reservation on the task before
 * anything is signed.
 *
 * The task's recorded reservation plus the nodes on its TxRecords are the source
 * of truth. A node that appears on any TxRecord was used by a prior attempt and
 * is never handed to the signer again. While the recorded hold is live and still
 * has unused nodes (a reclaim after a crash), those nodes are reused under the
 * same key without asking host-manager again. Otherwise the next reservation
 * walks to `epoch + 1`: every node of the previous one was used (assigned, or
 * failed to assign) or its hold lapsed, so a fresh key gets fresh nodes. A failed
 * request records nothing, so the next attempt re-issues the same key and
 * host-manager replays it if the lost request did reserve.
 */
export async function reserveListNodes(
  tasks: TasksCollection,
  events: EventsCollection,
  task: OutstandingTasksDocument,
  count: number,
  signal: AbortSignal
): Promise<ReserveOutcome> {
  const used = new Set((task.transactions ?? []).flatMap((record) => record.nodes ?? []));
  const unused = (nodes: ReservedNode[]) => nodes.filter(({ node }) => !used.has(node)).slice(0, count);

  const recorded = task.reservation;
  const reservation =
    recorded && isLive(recorded) && unused(recorded.nodes).length > 0
      ? recorded
      : await requestReservation(tasks, events, task, count, signal);
  if ("kind" in reservation) return reservation;

  const nodes = unused(reservation.nodes);
  if (nodes.length < count) {
    await events.insertOne({
      deploymentId: task.deploymentId,
      category: "Deployment",
      type: "JOB_RESERVE_SHORTFALL",
      message: `${count - nodes.length} of ${count} job(s) waiting for a matching node`,
      created_at: new Date(),
    });
  }

  return { kind: "reserved", reservation, nodes };
}

/** Reserve under the next epoch's key and persist the result; a failure records nothing. */
async function requestReservation(
  tasks: TasksCollection,
  events: EventsCollection,
  task: OutstandingTasksDocument,
  count: number,
  signal: AbortSignal
): Promise<TaskReservation | Exclude<ReserveOutcome, { kind: "reserved" }>> {
  const epoch = task.reservation ? task.reservation.epoch + 1 : 0;
  const key = buildIdempotencyKey(task._id.toHexString(), "reserve", epoch);
  const { market, requirements } = task.deployment;

  const response = await reserve(
    {
      market,
      ...(requirements && { requirements }),
      count: Math.min(count, MAX_RESERVATION_COUNT),
      idempotencyKey: key,
    },
    signal
  ).catch(reservationFailure);
  if ("kind" in response) return response;

  const reservation: TaskReservation = {
    key,
    epoch,
    expiresAt: response.expiresAt ? new Date(response.expiresAt) : null,
    nodes: response.nodes.map(({ nodeAddress, market }) => ({ node: nodeAddress, market })),
  };
  await tasks.updateOne({ _id: task._id }, { $set: { reservation } });

  if (reservation.nodes.length > 0) {
    const markets = [...new Set(reservation.nodes.map((node) => node.market))];
    await events.insertOne({
      deploymentId: task.deploymentId,
      category: "Deployment",
      type: "JOB_RESERVE_CONFIRMED",
      message: `Reserved ${reservation.nodes.length} node(s) in market(s) ${markets.join(", ")}`,
      created_at: new Date(),
    });
  }
  return reservation;
}

function reservationFailure(error: unknown): Exclude<ReserveOutcome, { kind: "reserved" }> {
  const action = classifyReservationError(error);
  if (action === "IN_PROGRESS") return { kind: "in-progress" };
  if (action === "FATAL") return { kind: "fatal", error: `Node reservation rejected: ${messageOf(error)}` };
  return { kind: "retry", error: `Node reservation failed: ${messageOf(error)}` };
}

function isLive({ expiresAt }: TaskReservation): boolean {
  return expiresAt !== null && expiresAt.getTime() > Date.now();
}
