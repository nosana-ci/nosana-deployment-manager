import { ObjectId } from "mongodb";

import { TaskFinishedReason, TaskType } from "../types/index.js";

export type Stats = {
  started_at: Date;
  jobs: {
    listed: number,
    extended: number,
    stopped: number,
  }
  tasks: {
    in_progress: number;
    failed: number;
    successful: number;
    timed_out: number;
    average_time_ms: number;
  }
};

let stats: Stats;
let in_progress_tasks: Map<ObjectId, [TaskType, Date]> = new Map();

export function initStats(): void {
  stats = {
    started_at: new Date(),
    jobs: {
      listed: 0,
      extended: 0,
      stopped: 0
    },
    tasks: {
      in_progress: 0,
      failed: 0,
      successful: 0,
      timed_out: 0,
      average_time_ms: 0
    }
  };
}

export function addTaskStat(taskId: ObjectId, taskType: TaskType): void {
  if (!stats) {
    throw new Error("Stats not initialized.");
  }

  in_progress_tasks.set(taskId, [taskType, new Date()]);
  stats.tasks.in_progress += 1;
}

export function removeTaskStat(taskId: ObjectId, successCount: number, reason: TaskFinishedReason): void {
  if (!stats) {
    throw new Error("Stats not initialized.");
  }

  const task = in_progress_tasks.get(taskId);
  if (task) {
    in_progress_tasks.delete(taskId);
    const [taskType, startTime] = task;

    switch (reason) {
      case "COMPLETED":
        stats.tasks.successful += 1;
        break;
      case "FAILED":
        stats.tasks.failed += 1;
        break;
      case "TIMEOUT":
        stats.tasks.timed_out += 1;
        break;
    }

    switch (taskType) {
      case TaskType.LIST:
        stats.jobs.listed += successCount;
        break;
      case TaskType.EXTEND:
        stats.jobs.extended += successCount;
        break;
      case TaskType.STOP:
        stats.jobs.stopped += successCount;
        break;
    }

    const taskDuration = new Date().getTime() - startTime.getTime();
    const totalCompletedTasks = stats.tasks.successful + stats.tasks.failed + stats.tasks.timed_out;

    stats.tasks.average_time_ms += (taskDuration - stats.tasks.average_time_ms) / totalCompletedTasks;

    stats.tasks.in_progress -= 1;
  }
}

export function getStats(): Stats {
  if (!stats) {
    throw new Error("Stats not initialized.");
  }

  return stats;
}
