import { Collection, DeleteResult, ObjectId, WithId } from "mongodb";

import { DeploymentDocument, TaskDocument, TaskStatus } from "../../../types/index.js";

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
  tasks: Collection<TaskDocument>,
  deployments: Collection<DeploymentDocument>,
  task: WithId<TaskDocument>
): Promise<void> {
  console.error(
    `[tasks] abandoning ${task.task} task ${task._id.toHexString()} for deployment ${task.deploymentId} after ${task.attempts} attempts`
  );
  await tasks.deleteOne({ _id: { $eq: task._id } });
  await deployments
    .updateOne({ id: task.deploymentId }, { $set: { status: "ERROR" } })
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
 * In-flight-retry guard: a task whose CM call never reached a definitive answer
 * within `task_max_inflight_retries` is removed and its deployment flagged ERROR
 * — distinct from the crash-loop cap so a stuck key / CM outage can't retry
 * forever. Mirrors {@link abandonOverCap}.
 */
export async function abandonInflightExhausted(
  tasks: Collection<TaskDocument>,
  deployments: Collection<DeploymentDocument>,
  task: WithId<TaskDocument>
): Promise<void> {
  console.error(
    `[tasks] abandoning ${task.task} task ${task._id.toHexString()} for deployment ${task.deploymentId} after ${task.inflight_retries} in-flight retries`
  );
  await tasks.deleteOne({ _id: { $eq: task._id } });
  await deployments
    .updateOne({ id: task.deploymentId }, { $set: { status: "ERROR" } })
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
 * lease never bumps another consumer's task.
 */
export async function incrementAttempt(
  tasks: Collection<TaskDocument>,
  id: ObjectId,
  consumerId: string
): Promise<void> {
  await tasks.updateOne({ _id: id, claimed_by: consumerId }, { $inc: { attempts: 1 } });
}

/**
 * Delete a completed task, fenced on the lease holder so a consumer that lost
 * its lease never deletes another consumer's work.
 */
export function deleteCompletedTask(
  tasks: Collection<TaskDocument>,
  id: ObjectId,
  consumerId: string
): Promise<DeleteResult> {
  return tasks.deleteOne({ _id: id, claimed_by: consumerId });
}
