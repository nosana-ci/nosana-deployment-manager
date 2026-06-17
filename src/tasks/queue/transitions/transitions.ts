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
