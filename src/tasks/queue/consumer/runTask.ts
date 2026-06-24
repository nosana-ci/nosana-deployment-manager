import { Db } from "mongodb";

import { runListTask } from "../../task/list/run.js";
import { runStopTask } from "../../task/stop/run.js";
import { runExtendTask } from "../../task/extend/run.js";
import { OutstandingTasksDocument, TaskRunResult, TaskType } from "../../../types/index.js";

/**
 * Route a claimed task to the runner for its type. `db` is threaded to the EXTEND
 * and STOP runners, whose reschedules go through `scheduleTask(db, …)` (EXTEND's
 * confirm cycle; STOP's full-stop straggler self-heal); LIST reads its collections
 * from the repository singleton.
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
      return runStopTask(db, task, signal);
    case TaskType.EXTEND:
      return runExtendTask(db, task, signal);
    default:
      return Promise.resolve({ outcome: "COMPLETED", successCount: 0 });
  }
}
