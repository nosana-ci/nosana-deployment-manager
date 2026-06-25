import { getNextTaskTime } from "../../../utils/index.js";
import { getRepository } from "../../../../repositories/index.js";

import {
  DeploymentStrategy,
  OutstandingTasksDocument,
  TaskStatus,
  TaskType,
} from "../../../../types/index.js";

/**
 * Post-run side effects for a successful LIST task: for SCHEDULED deployments,
 * enqueue the next cron firing. (Errors no longer land here — a handled error
 * reschedules the task with a cooldown before the runner reaches this point.)
 */
export async function onListExit(task: OutstandingTasksDocument) {
  const tasks = getRepository("tasks").collection;

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
