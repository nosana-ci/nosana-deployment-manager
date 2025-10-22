import { Db } from "mongodb";

import { OnListEventParams } from "../spawner.js";
import { getNextTaskTime } from "../../../utils/index.js";
import { scheduleTask } from "../../../scheduleTask.js";

import {
  DeploymentStrategy,
  TaskType,
} from "../../../../types/index.js";

export async function onListExit(
  {
    error,
    collections: { tasks },
    task: {
      deploymentId,
      deployment: { timeout, strategy, schedule, status },
      due_at,
    },
  }: OnListEventParams,
  db: Db
) {
  if (!error) {
    if (strategy === DeploymentStrategy["SIMPLE-EXTEND"]) {
      scheduleTask(
        db,
        TaskType.EXTEND,
        deploymentId,
        status,
        new Date(
          new Date().getTime() +
          (timeout - Math.min(Math.max(timeout - timeout * 0.9, 60), 300)) *
          1000
        )
      );
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
