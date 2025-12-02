import { getNextTaskTime } from "../../../utils/index.js";

import {
  DeploymentStrategy,
  TaskType,
} from "../../../../types/index.js";
import type { OnListEventParams } from "../spawner.js";

export async function onListExit(
  {
    collections: { tasks },
    task: {
      deploymentId,
      deployment: { strategy, schedule },
      due_at,
    },
  }: OnListEventParams,
) {
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
