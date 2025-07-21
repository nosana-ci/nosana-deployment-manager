import { Db, ObjectId } from "mongodb";
import { Worker } from "worker_threads";

import { getConfig } from "../config/index.js";
import { spawnListTask } from "./task/list/spawner.js";
import { spawnStopTask } from "./task/stop/spawner.js";
import { spawnExtendTask } from "./task/extend/spawner.js";
import { getOutstandingTasks } from "./getOutstandingTasks.js";

import { TaskDocument, TaskType } from "../types.js";

export function startTaskListener(db: Db) {
  const tasks = new Map<ObjectId, Worker>();
  const collection = db.collection<TaskDocument>("tasks");
  const { tasks_batch_size } = getConfig();
  let fetchTasksInterval: NodeJS.Timeout | undefined = undefined;

  const completeTask = async (id: ObjectId) => {
    const { acknowledged } = await collection.deleteOne({
      _id: { $eq: id },
    });

    if (acknowledged) {
      tasks.delete(id);
    }
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
      switch (task.task) {
        case TaskType.LIST:
          tasks.set(
            task._id,
            spawnListTask(db, task, () => completeTask(task._id))
          );
          break;
        case TaskType.EXTEND:
          tasks.set(
            task._id,
            spawnExtendTask(db, task, () => completeTask(task._id))
          );
          break;
        case TaskType.STOP:
          tasks.set(
            task._id,
            spawnStopTask(db, task, () => completeTask(task._id))
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
