import type { Db } from "mongodb";

import {
  DeploymentCollection,
  DeploymentDocument,
  DeploymentStatus,
  TaskDocument,
  TasksCollection,
  TaskType,
} from "../types/index.js";

export async function scheduleTask(
  db: Db,
  task: TaskType,
  deploymentId: string,
  deploymentStatus: DeploymentStatus,
  due_at = new Date(),
  active_revision?: number,
) {
  const tasks: TasksCollection = db.collection<TaskDocument>("tasks");
  const deployments: DeploymentCollection = db.collection<DeploymentDocument>("deployments");

  const { acknowledged } = await tasks.insertOne({
    task,
    due_at,
    deploymentId,
    tx: undefined,
    active_revision,
    created_at: new Date(),
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
