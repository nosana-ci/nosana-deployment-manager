import type { Db } from "mongodb";

import { getRepository } from "../../../repositories/index.js";
import { scheduleTask } from "../../scheduleTask.js";
import { DeploymentStatus, TaskType } from "../../../types/index.js";

/**
 * Foul-play teardown. A negative CM balance is only reachable by us clawing an
 * owner's credits back, so it condemns the whole ACCOUNT — not one deployment.
 * We archive every deployment the owner has, drop their pending LIST/EXTEND churn,
 * and enqueue a STOP per deployment to delist its on-chain jobs.
 *
 * ARCHIVED is terminal: the DM leaves archived deployments alone, and the stop
 * finalizer ({@link jobAllActiveJobsStop}) and the abandon transitions are fenced
 * to never flip an ARCHIVED deployment back to STOPPED/ERROR — so the delist can
 * run to completion without reviving it.
 *
 * Idempotent: skips deployments already ARCHIVED, so several of the owner's tasks
 * hitting the negative balance at once don't stampede.
 */
export async function archiveBannedOwner(db: Db, owner: string): Promise<void> {
  const deployments = getRepository("deployments");
  const tasks = getRepository("tasks").collection;

  const owned = await deployments
    .findAll(
      { owner, status: { $ne: DeploymentStatus.ARCHIVED } },
      { projection: { id: 1, status: 1 } }
    )

  if (owned.length === 0) return;

  const ids = owned.map(({ id }) => id);

  // Stop provisioning churn immediately; keep STOP tasks so an in-flight stop can
  // still finish (the enqueue below is idempotent against them).
  await tasks.deleteMany({ deploymentId: { $in: ids }, task: { $ne: TaskType.STOP } });

  // Delist each deployment's on-chain jobs via the STOP worker.
  for (const { id, status } of owned) {
    await scheduleTask(db, TaskType.STOP, id, status, new Date(), { idempotent: true });
  }

  // Terminal — the fenced finalizers keep the delist from reverting it.
  await deployments.collection.updateMany(
    { id: { $in: ids } },
    { $set: { status: DeploymentStatus.ARCHIVED } }
  );
}
