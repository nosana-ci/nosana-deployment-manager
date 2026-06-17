import type { Db } from "mongodb";

import { getRepository } from "../repositories/index.js";
import { DeploymentStatus, TaskStatus, TaskType } from "../types/index.js";

type ScheduleTaskOptions = Partial<{
  active_revision?: number;
  limit?: number;
  job?: string;
}>

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
  }: ScheduleTaskOptions = {}
) {
  void db;
  const tasks = getRepository("tasks").collection;
  const deployments = getRepository("deployments").collection;

  const { acknowledged } = await tasks.insertOne({
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
  });

  if (!acknowledged) {
    console.error(
      `Failed to schedule ${task} task for deployment ${deploymentId}.`
    );
  }

  if (deploymentStatus === DeploymentStatus.STARTING) {
    await deployments.updateOne(
      { id: deploymentId },
      {
        $set: {
          status: DeploymentStatus.RUNNING,
        },
      }
    );
  }
}
