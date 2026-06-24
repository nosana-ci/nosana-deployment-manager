import type { Db } from "mongodb";

import { getRepository } from "../repositories/index.js";
import { DeploymentStatus, TaskStatus, TaskType } from "../types/index.js";

type ScheduleTaskOptions = Partial<{
  active_revision?: number;
  limit?: number;
  job?: string;
  /**
   * Skip the insert when an identical PENDING task (same task/deployment/job)
   * already exists. Makes a recurring re-schedule idempotent — e.g. the EXTEND
   * chain, where a crash after confirm but before the source task is deleted
   * would otherwise let a reclaim queue a duplicate cycle (a double-extend). The
   * per-deployment task lock serialises this, so the check needs no unique index.
   */
  idempotent?: boolean;
}>

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
    idempotent,
  }: ScheduleTaskOptions = {}
): Promise<boolean> {
  void db;
  const tasks = getRepository("tasks").collection;
  const deployments = getRepository("deployments").collection;

  const doc = {
    task,
    due_at,
    deploymentId,
    tx: undefined,
    active_revision,
    limit,
    job,
    created_at: new Date(),
    status: TaskStatus.PENDING,
    attempts: 0,
  };

  let created = true;
  if (idempotent) {
    // At most one PENDING task per (task, deployment, job): a re-schedule while
    // one is still queued is a no-op, so a reclaimed confirm can't double-queue.
    const { upsertedCount } = await tasks.updateOne(
      { task, deploymentId, status: TaskStatus.PENDING, ...(job !== undefined ? { job } : {}) },
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

  if (created && deploymentStatus === DeploymentStatus.STARTING) {
    await deployments.updateOne(
      { id: deploymentId },
      {
        $set: {
          status: DeploymentStatus.RUNNING,
        },
      }
    );
  }

  return created;
}
