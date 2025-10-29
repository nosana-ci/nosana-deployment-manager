import { Db, ObjectId } from "mongodb";
import { Worker } from "worker_threads";

import { getConfig } from "../config/index.js";
import { spawnListTask } from "./task/list/spawner.js";
import { spawnStopTask } from "./task/stop/spawner.js";
import { spawnExtendTask } from "./task/extend/spawner.js";
import { getOutstandingTasks } from "./getOutstandingTasks.js";

import { TaskDocument, TaskFinishedReason, TaskType } from "../types/index.js";
import { addTaskStat, removeTaskStat } from "../stats/index.js";

export function startTaskListener(db: Db) {
  const tasks = new Map<ObjectId, Worker>();
  const collection = db.collection<TaskDocument>("tasks");
  const { tasks_batch_size } = getConfig();
  let fetchTasksInterval: NodeJS.Timeout | undefined = undefined;

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
    }, 120 * 1000);
  };

  const fetchNewTasks = async () => {
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
    stop: () => {
      if (fetchTasksInterval) {
        clearInterval(fetchTasksInterval);
      }
    },
  };
}
