import { Db, ObjectId } from "mongodb";
import { Worker } from "worker_threads";

import { getConfig } from "../config/index.js";
import { spawnListTask } from "./task/list/spawner.js";
import { spawnStopTask } from "./task/stop/spawner.js";
import { spawnExtendTask } from "./task/extend/spawner.js";
import { getOutstandingTasks } from "./getOutstandingTasks.js";

import { TaskDocument, TaskFinishedReason, TaskType } from "../types/index.js";
import { addTaskStat, removeTaskStat } from "../stats/index.js";

export const TASK_TIMEOUT_MS = 120_000;
export const TASK_DRAIN_POLL_INTERVAL_MS = 500;

export type TaskCollectionListenerHandle = {
  stop: () => Promise<void>;
};

export function startTaskCollectionListener(db: Db): TaskCollectionListenerHandle {
  const tasks = new Map<ObjectId, Worker>();
  const collection = db.collection<TaskDocument>("tasks");
  const { tasks_batch_size } = getConfig();
  let fetchTasksInterval: NodeJS.Timeout | undefined = undefined;
  let stopped = false;

  const completeTask = async (id: ObjectId, successCount: number, reason: TaskFinishedReason) => {
    const { acknowledged } = await collection.deleteOne({
      _id: { $eq: id },
    });

    if (acknowledged) {
      tasks.delete(id);
      removeTaskStat(id, successCount, reason);
    }
  };

  const spawnNewTask = (taskId: ObjectId, worker: Worker) => {
    tasks.set(taskId, worker);

    setTimeout(() => {
      if (tasks.has(taskId)) {
        const worker = tasks.get(taskId)!;
        completeTask(taskId, 0, "TIMEOUT");
        worker.terminate();
      }
    }, TASK_TIMEOUT_MS);
  };

  const fetchNewTasks = async () => {
    if (stopped) return;
    if (tasks.size >= tasks_batch_size) {
      return;
    }

    const newTasks = await getOutstandingTasks(
      collection,
      [...tasks.keys()],
      tasks_batch_size
    );

    newTasks.forEach((task) => {
      addTaskStat(task._id, task.task);
      switch (task.task) {
        case TaskType.LIST:
          spawnNewTask(
            task._id,
            spawnListTask(db, task, (successCount: number, reason: TaskFinishedReason) => completeTask(task._id, successCount, reason))
          );
          break;
        case TaskType.EXTEND:
          spawnNewTask(
            task._id,
            spawnExtendTask(db, task, (successCount: number, reason: TaskFinishedReason) => completeTask(task._id, successCount, reason))
          );
          break;
        case TaskType.STOP:
          spawnNewTask(
            task._id,
            spawnStopTask(db, task, (successCount: number, reason: TaskFinishedReason) => completeTask(task._id, successCount, reason))
          );
          break;
      }
    });
  };

  fetchNewTasks().then(() => {
    fetchTasksInterval = setInterval(async () => await fetchNewTasks(), 5000);
  });

  return {
    stop: async () => {
      stopped = true;
      if (fetchTasksInterval) {
        clearInterval(fetchTasksInterval);
        fetchTasksInterval = undefined;
      }

      // Wait for in-flight workers to finish, capped at the per-task timeout.
      const deadline = Date.now() + TASK_TIMEOUT_MS;
      while (tasks.size > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, TASK_DRAIN_POLL_INTERVAL_MS));
      }

      // Force-terminate any survivors. Their task documents stay in Mongo and
      // are reclaimed by the next process via the same polling logic
      // (at-least-once semantics, already exercised by the existing TIMEOUT path).
      for (const [id, worker] of tasks) {
        await worker.terminate();
        tasks.delete(id);
      }
    },
  };
}
