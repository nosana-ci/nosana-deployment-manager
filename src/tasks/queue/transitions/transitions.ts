import { Collection, DeleteResult, Filter, ObjectId, WithId } from "mongodb";

import { DeploymentDocument, TaskDocument, TaskStatus } from "../../../types/index.js";

import type { Repository } from "../../../repositories/index.js";

/** Deletes go through the tasks repository, which releases the deleted LISTs' reservations. */
type TaskDeleter = Pick<Repository<TaskDocument>, "delete">;

/**
 * Task lifecycle state transitions: the Mongo writes that move a task document
 * between states. Kept separate from the consumer loop so they can be unit
 * tested in isolation, and so Phase 2 (retry / cooldown / dead-letter) has a
 * single home to add `scheduleRetry`, `markDead`, etc.
 */

/** Re-queue delay applied when a task is handed back without running. */
const REQUEUE_DELAY_MS = 1_000;

/** Fallback in-flight retry delay when the CM gave no `Retry-After` hint. */
const INFLIGHT_RETRY_DEFAULT_MS = 5_000;

/**
 * Crash-loop guard: a task claimed beyond the attempts cap is removed and its
 * deployment flagged ERROR. Phase 1 keeps today's terminal-failure behaviour;
 * Phase 2 will replace this with a dead-letter transition.
 */
export async function abandonOverCap(
  tasks: TaskDeleter,
  deployments: Collection<DeploymentDocument>,
  task: WithId<TaskDocument>
): Promise<void> {
  console.error(
    `[tasks] abandoning ${task.task} task ${task._id.toHexString()} for deployment ${task.deploymentId} after ${task.attempts} attempts`
  );
  await tasks.delete({ _id: { $eq: task._id } });
  await deployments
    // Don't clobber a terminal ARCHIVED (foul-play teardown) back to ERROR.
    .updateOne({ id: task.deploymentId, status: { $ne: "ARCHIVED" } }, { $set: { status: "ERROR" } })
    .catch((error) => console.error("[tasks] failed to flag deployment ERROR", error));
}

/**
 * Reschedule a task that ended in-flight (API-path IN_PROGRESS / transient 5xx /
 * lost response): make it claimable again after `retryAfterMs` (the CM's
 * `Retry-After`, or a default). This is a legitimate wait, NOT a crash — so it
 * undoes this dispatch's `attempts` increment and bumps the separate
 * `inflight_retries` counter (bounded by `task_max_inflight_retries`) instead.
 * Fenced on the lease holder so a consumer that lost its lease never reschedules
 * another consumer's task.
 */
export async function rescheduleInflight(
  tasks: Collection<TaskDocument>,
  id: ObjectId,
  consumerId: string,
  retryAfterMs?: number
): Promise<void> {
  const delay = retryAfterMs ?? INFLIGHT_RETRY_DEFAULT_MS;
  await tasks.updateOne(
    { _id: id, claimed_by: consumerId },
    {
      $set: { status: TaskStatus.PENDING, due_at: new Date(Date.now() + delay) },
      $unset: { claimed_by: "", lease_expires_at: "" },
      $inc: { attempts: -1, inflight_retries: 1 },
    }
  );
}

/**
 * Park a LIST whose reservation request host-manager is holding: claimable again
 * after `delayMs`, to renew it. Waiting for capacity is neither a crash nor an
 * in-flight retry, so this undoes the dispatch's `attempts` increment and leaves
 * `inflight_retries` alone. Fenced on the lease holder, and on the pending
 * request still being recorded: a webhook that filled it mid-run cleared it and
 * recorded the nodes, so the task is released due now to assign them instead.
 */
export async function parkTask(
  tasks: Collection<TaskDocument>,
  id: ObjectId,
  consumerId: string,
  delayMs: number
): Promise<void> {
  const release = (filter: Filter<TaskDocument>, due_at: Date) =>
    tasks.updateOne(filter, {
      $set: { status: TaskStatus.PENDING, due_at },
      $unset: { claimed_by: "", lease_expires_at: "" },
      $inc: { attempts: -1 },
    });

  const parkedUntil = new Date(Date.now() + delayMs);
  const { matchedCount } = await release(
    { _id: id, claimed_by: consumerId, reservation_request: { $exists: true } },
    parkedUntil
  );
  if (matchedCount === 0) await release({ _id: id, claimed_by: consumerId }, new Date());
}

/**
 * In-flight-retry guard: a task whose CM call never reached a definitive answer
 * within `task_max_inflight_retries` is removed and its deployment flagged ERROR
 * — distinct from the crash-loop cap so a stuck key / CM outage can't retry
 * forever. Mirrors {@link abandonOverCap}.
 */
export async function abandonInflightExhausted(
  tasks: TaskDeleter,
  deployments: Collection<DeploymentDocument>,
  task: WithId<TaskDocument>
): Promise<void> {
  console.error(
    `[tasks] abandoning ${task.task} task ${task._id.toHexString()} for deployment ${task.deploymentId} after ${task.inflight_retries} in-flight retries`
  );
  await tasks.delete({ _id: { $eq: task._id } });
  await deployments
    // Don't clobber a terminal ARCHIVED (foul-play teardown) back to ERROR.
    .updateOne({ id: task.deploymentId, status: { $ne: "ARCHIVED" } }, { $set: { status: "ERROR" } })
    .catch((error) => console.error("[tasks] failed to flag deployment ERROR", error));
}

/**
 * Hand a task back to PENDING (e.g. on lock contention). Attempts are counted
 * only at dispatch, so there is nothing to undo here.
 */
export async function releaseTaskToPending(
  tasks: Collection<TaskDocument>,
  id: ObjectId
): Promise<void> {
  await tasks.updateOne(
    { _id: { $eq: id } },
    {
      $set: { status: TaskStatus.PENDING, due_at: new Date(Date.now() + REQUEUE_DELAY_MS) },
      $unset: { claimed_by: "", lease_expires_at: "" },
    }
  );
}

/**
 * Count a real dispatch, fenced on the lease holder so a consumer that lost its
 * lease never bumps another consumer's task. False when the fence matched
 * nothing — the task was deleted (a stop swept it) or reclaimed by another
 * consumer since it was claimed — and the caller must not dispatch it.
 */
export async function incrementAttempt(
  tasks: Collection<TaskDocument>,
  id: ObjectId,
  consumerId: string
): Promise<boolean> {
  const { matchedCount } = await tasks.updateOne({ _id: id, claimed_by: consumerId }, { $inc: { attempts: 1 } });
  return matchedCount > 0;
}

/**
 * Drop a task whose intent no longer holds (see `isTaskWanted`): delete it,
 * fenced on the lease holder, which also cancels a LIST's reservation request.
 * Not a failure: the deployment is left as it is.
 */
export async function dropUnwantedTask(
  tasks: TaskDeleter,
  task: Pick<WithId<TaskDocument>, "_id" | "task" | "deploymentId">,
  consumerId: string
): Promise<void> {
  console.log(
    `[tasks] dropping ${task.task} task ${task._id.toHexString()} for deployment ${task.deploymentId}: no longer wanted`
  );
  await tasks.delete({ _id: task._id, claimed_by: consumerId });
}

/**
 * Delete a completed task, fenced on the lease holder so a consumer that lost
 * its lease never deletes another consumer's work.
 */
export function deleteCompletedTask(
  tasks: TaskDeleter,
  id: ObjectId,
  consumerId: string
): Promise<DeleteResult> {
  return tasks.delete({ _id: id, claimed_by: consumerId });
}
