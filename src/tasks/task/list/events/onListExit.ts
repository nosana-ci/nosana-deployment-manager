import { getNextTaskTime } from "../../../utils/index.js";
import { getRepository } from "../../../../repositories/index.js";

import {
  DeploymentStatus,
  DeploymentStrategy,
  OutstandingTasksDocument,
  TaskStatus,
  TaskType,
} from "../../../../types/index.js";

/**
 * Post-run side effects for a LIST task: apply any deployment error status, and
 * for SCHEDULED deployments enqueue the next firing.
 */
export async function onListExit(
  task: OutstandingTasksDocument,
  newDeploymentStatus: DeploymentStatus | undefined
) {
  const deployments = getRepository("deployments").collection;
  const tasks = getRepository("tasks").collection;

  if (newDeploymentStatus) {
    try {
      await deployments.updateOne(
        { id: task.deploymentId },
        { $set: { status: newDeploymentStatus } }
      );
    } catch (error) {
      console.error("Failed to update deployment status:", error);
    }
  }

  const { strategy, schedule } = task.deployment;
  if (strategy === DeploymentStrategy.SCHEDULED && schedule) {
    await tasks.insertOne({
      task: TaskType.LIST,
      due_at: getNextTaskTime(schedule, task.due_at),
      deploymentId: task.deploymentId,
      tx: undefined,
      created_at: new Date(),
      status: TaskStatus.PENDING,
      attempts: 0,
    });
  }
}
