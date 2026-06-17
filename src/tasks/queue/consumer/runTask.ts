import { Db } from "mongodb";

import { runListTask } from "../../task/list/run.js";
import { runStopTask } from "../../task/stop/run.js";
import { runExtendTask } from "../../task/extend/run.js";
import { OutstandingTasksDocument, TaskRunResult, TaskType } from "../../../types/index.js";

/**
 * Route a claimed task to the runner for its type. `db` is threaded only to the
 * EXTEND runner, whose confirm handler reschedules via `scheduleTask(db, …)`;
 * LIST/STOP read their collections from the repository singleton.
 */
export function runTask(
  db: Db,
  task: OutstandingTasksDocument,
  signal: AbortSignal
): Promise<TaskRunResult> {
  switch (task.task) {
    case TaskType.LIST:
      return runListTask(task, signal);
    case TaskType.STOP:
      return runStopTask(task, signal);
    case TaskType.EXTEND:
      return runExtendTask(db, task, signal);
    default:
      return Promise.resolve({ outcome: "COMPLETED", successCount: 0 });
  }
}
