import { getRepository } from "../../../repositories/index.js";
import { ACTIVE_JOB_STATES, DeploymentStatus, TaskType } from "../../../types/index.js";

import type { Filter } from "mongodb";
import type { DeploymentDocument, TaskDocument } from "../../../types/index.js";

/**
 * Whether a task is still wanted is decided here and nowhere else. A task is an
 * intent derived from its deployment ("list N jobs of revision R", "extend job
 * J", "retire the jobs of other revisions"), so it is re-validated against the
 * deployment when it runs: listeners and routes schedule naively, and a task
 * whose intent no longer holds is dropped when it comes due.
 */

/**
 * The statuses in which a deployment is meant to have jobs. INSUFFICIENT_FUNDS
 * is one of them: a LIST retrying on the funds ladder is what sets it, and that
 * LIST (and the deployment's other work) must keep running through it.
 */
export const RUNNING_STATUSES: readonly DeploymentStatus[] = [
  DeploymentStatus.STARTING,
  DeploymentStatus.RUNNING,
  DeploymentStatus.INSUFFICIENT_FUNDS,
];

/**
 * Whether a task's intent still holds against its deployment:
 *   - LIST   — the deployment is running, the task's revision is the active one,
 *              and it was scheduled in the deployment's current run: a LIST from
 *              before a stop and restart never tops back up.
 *   - EXTEND — the deployment is running and the job is still active. Its intent
 *              is the job's, not the run's: a restart without a stop (from
 *              ERROR or INSUFFICIENT_FUNDS) keeps the job, and must keep it alive.
 *   - STOP   — always, except a revision stop whose revision has been superseded:
 *              the newer swap's STOP retires everything that is not the new revision.
 *              Stopping a job is right whichever run it belongs to.
 *
 * A task without a revision (a full, targeted or trimming STOP, or a LIST
 * queued before revisions were frozen on tasks) counts as the active revision;
 * a run missing on either side (from before runs were counted) as the current run.
 */
export function isTaskWanted(
  task: Pick<TaskDocument, "task" | "active_revision" | "run">,
  deployment: Pick<DeploymentDocument, "status" | "active_revision" | "run">,
  jobActive: boolean
): boolean {
  const running = RUNNING_STATUSES.includes(deployment.status);
  const current = (task.active_revision ?? deployment.active_revision) === deployment.active_revision;
  const sameRun = task.run === undefined || deployment.run === undefined || task.run === deployment.run;

  switch (task.task) {
    case TaskType.LIST:
      return running && current && sameRun;
    case TaskType.EXTEND:
      return running && jobActive;
    case TaskType.STOP:
      return current;
  }
}

/**
 * A LIST whose jobs may still land on-chain: a transaction still holding its
 * signed bytes (self-custody persists them before broadcast and clears them
 * once the tx confirms or provably expires), or an assign batch the API path
 * posted (its verdict is only known by re-sending it under its key). Such a
 * task is never dropped: it is drained, recording the jobs that landed so they
 * can be stopped. Only a LIST needs this — a STOP or EXTEND that lands
 * unrecorded changes a job the accounts listener already tracks.
 *
 * As filter conditions (`$or` to select such tasks, `$nor` to spare them) and
 * as a predicate on a loaded task; the two must stay in step.
 */
export const LIST_IN_FLIGHT: Filter<TaskDocument>[] = [
  { task: TaskType.LIST, transactions: { $elemMatch: { blob: { $ne: null } } } },
  { task: TaskType.LIST, assign_posted_at: { $exists: true } },
];

export function isListInFlight(task: TaskDocument): boolean {
  if (task.task !== TaskType.LIST) return false;
  return task.assign_posted_at !== undefined || (task.transactions ?? []).some(({ blob }) => Boolean(blob));
}

/**
 * {@link isTaskWanted} against the deployment (and an EXTEND's job) as stored
 * now, never the snapshot the task was claimed with: the stop route flips the
 * status without taking the deployment lock. The consumer asks once it holds
 * the lock, and a LIST or EXTEND asks again right before it signs.
 */
export async function checkTaskWanted(task: TaskDocument): Promise<boolean> {
  const deployment = await getRepository("deployments").collection.findOne(
    { id: task.deploymentId },
    { projection: { status: 1, active_revision: 1, run: 1 } }
  );
  if (!deployment) return false;

  const jobActive =
    task.task === TaskType.EXTEND && task.job
      ? (await getRepository("jobs").count({ job: task.job, state: { $in: [...ACTIVE_JOB_STATES] } })) > 0
      : true;

  return isTaskWanted(task, deployment, jobActive);
}
