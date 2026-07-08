import { Db } from "mongodb";

import { runListTask } from "../../task/list/run.js";
import { runStopTask } from "../../task/stop/run.js";
import { runExtendTask } from "../../task/extend/run.js";
import { OutstandingTasksDocument, TaskRunResult, TaskType } from "../../../types/index.js";

/**
 * Route a claimed task to the runner for its type. `db` is threaded to every
 * runner: EXTEND/STOP reschedule through `scheduleTask(db, …)`, and all three can
 * archive a banned owner (which enqueues STOP tasks) on a negative-balance error.
 */
export function runTask(
  db: Db,
  task: OutstandingTasksDocument,
  signal: AbortSignal
): Promise<TaskRunResult> {
  switch (task.task) {
    case TaskType.LIST:
      return runListTask(db, task, signal);
    case TaskType.STOP:
      return runStopTask(db, task, signal);
    case TaskType.EXTEND:
      return runExtendTask(db, task, signal);
    default:
      return Promise.resolve({ outcome: "COMPLETED", successCount: 0 });
  }
}
