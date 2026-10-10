import type { Db, ObjectId } from "mongodb";

import { getRepository } from "../repositories/index.js";
import { DeploymentStatus, TaskStatus, TaskType } from "../types/index.js";
import type { TaskDocument, TaskReason } from "../types/index.js";

type ScheduleTaskOptions = {
  /**
   * The revision the task acts for (see `TaskDocument.active_revision`). A LIST
   * without one takes the deployment's active revision now.
   */
  active_revision?: number;
  limit?: number;
  job?: string;
  /**
   * One-shot EXTEND amount in seconds (see `TaskDocument.extend_seconds`). Set by
   * deploymentTimeoutUpdate to bump a running job to an increased timeout without
   * kicking off / continuing an extend chain.
   */
  extend_seconds?: number;
  /** Why the task was scheduled (see `TaskReason`); part of the idempotency key. */
  reason?: TaskReason;
  /**
   * The LIST task whose shortfall this LIST takes over (see
   * `TaskDocument.handoff_of`). Implies `idempotent`: at most one task is created
   * per source task, so a reclaimed source never hands off twice.
   */
  handoff_of?: ObjectId;
} & (
  | { idempotent?: false }
  /**
   * Skip the insert when an identical PENDING task (same task, deployment,
   * reason, job, limit, revision and run) already exists. Makes a recurring
   * re-schedule idempotent — e.g. the EXTEND chain, where a crash after confirm
   * but before the source task is deleted would otherwise let a reclaim queue a
   * duplicate cycle (a double-extend). The per-deployment task lock serialises
   * this, so the check needs no unique index. It needs the task's purpose: its
   * `job`, or else its `reason`.
   */
  | { idempotent: true; job: string }
  | { idempotent: true; reason: TaskReason }
);

/** @returns whether a new task was created (false when an idempotent skip no-oped). */
export async function scheduleTask(
  // `db` is retained for the existing strategy callers; the collections now come
  // from the repository singleton.
  db: Db,
  task: TaskType,
  deploymentId: string,
  deploymentStatus: DeploymentStatus,
  due_at = new Date(),
  {
    active_revision,
    limit,
    job,
    extend_seconds,
    reason,
    idempotent,
    handoff_of,
  }: ScheduleTaskOptions = {}
): Promise<boolean> {
  void db;
  const tasks = getRepository("tasks").collection;
  const deployments = getRepository("deployments").collection;

  // A LIST lists one revision in one run of the deployment, both frozen here:
  // refills, rotations, starts and rescales list whatever revision is active
  // when they are scheduled, and are dropped if a swap or a restart supersedes
  // it before they run.
  const current =
    task === TaskType.LIST
      ? await deployments.findOne({ id: deploymentId }, { projection: { active_revision: 1, run: 1 } })
      : null;
  const revision = active_revision ?? current?.active_revision;
  const run = current?.run;

  // Unset fields are left out rather than stored as null, so the idempotent
  // match below can tell "no job" (or reason, limit, revision, run) from any.
  const doc: TaskDocument = {
    task,
    due_at,
    deploymentId,
    tx: undefined,
    ...(revision !== undefined && { active_revision: revision }),
    ...(run !== undefined && { run }),
    ...(reason !== undefined && { reason }),
    ...(limit !== undefined && { limit }),
    ...(job !== undefined && { job }),
    ...(extend_seconds !== undefined && { extend_seconds }),
    ...(handoff_of && { handoff_of }),
    created_at: new Date(),
    status: TaskStatus.PENDING,
    attempts: 0,
  };

  let created = true;
  if (idempotent || handoff_of) {
    // At most one PENDING task per intent (task, deployment, reason, job,
    // limit, revision, run): a re-schedule while one is still queued is a no-op, so a
    // reclaimed confirm or a duplicate change event can't double-queue.
    // One-shot delta extends (`extend_seconds` set) are never matched, so a
    // pending re-alignment extend never dedups against — or blocks — the regular
    // EXTEND chain for the same (deployment, job).
    const { upsertedCount } = await tasks.updateOne(
      handoff_of
        ? { deploymentId, handoff_of }
        : {
            task,
            deploymentId,
            status: TaskStatus.PENDING,
            reason: reason ?? { $exists: false },
            job: job ?? { $exists: false },
            limit: limit ?? { $exists: false },
            active_revision: revision ?? { $exists: false },
            run: run ?? { $exists: false },
            extend_seconds: { $exists: false },
          },
      { $setOnInsert: doc },
      { upsert: true }
    );
    created = upsertedCount === 1;
  } else {
    const { acknowledged } = await tasks.insertOne(doc);
    if (!acknowledged) {
      console.error(`Failed to schedule ${task} task for deployment ${deploymentId}.`);
    }
  }

  // Fenced on STARTING: the caller's status is a snapshot, and a deployment
  // stopped since must not be flipped back to RUNNING.
  if (created && deploymentStatus === DeploymentStatus.STARTING) {
    await deployments.updateOne(
      { id: deploymentId, status: DeploymentStatus.STARTING },
      {
        $set: {
          status: DeploymentStatus.RUNNING,
        },
      }
    );
  }

  return created;
}
