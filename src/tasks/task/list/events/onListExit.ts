import { getNextTaskTime } from "../../../utils/index.js";

import {
  DeploymentStrategy,
  TaskType,
} from "../../../../types/index.js";
import type { OnListEventParams } from "../spawner.js";

export async function onListExit(
  {
    collections: { deployments, tasks },
    task: {
      deploymentId,
      deployment: { strategy, schedule },
      due_at,
    },
    newDeploymentStatus,
  }: OnListEventParams,
) {
  if (newDeploymentStatus) {
    try {
      await deployments.updateOne(
        { id: deploymentId },
        { $set: { status: newDeploymentStatus } }
      );
    } catch (error) {
      console.error("Failed to update deployment status:", error);
    }
  }
  if (strategy === DeploymentStrategy.SCHEDULED && schedule) {
    const nextTaskTime = getNextTaskTime(schedule, due_at);
    await tasks.insertOne({
      task: TaskType.LIST,
      due_at: nextTaskTime,
      deploymentId: deploymentId,
      tx: undefined,
      created_at: new Date(),
    });
  }
}
