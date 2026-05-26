import { ObjectId } from "mongodb";

import { TaskFinishedReason, TaskType } from "../types/index.js";
import type { WorkerMetrics } from "../metrics/worker.js";

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
let workerMetricsHandle: WorkerMetrics | null = null;

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

/**
 * Registers a `WorkerMetrics` handle so that `addTaskStat` / `removeTaskStat`
 * additionally drive the Prometheus worker metric collectors. Gated on a
 * nullable handle so existing call sites that don't pass metrics remain valid.
 */
export function registerWorkerMetrics(handle: WorkerMetrics): void {
  workerMetricsHandle = handle;
}

export function addTaskStat(taskId: ObjectId, taskType: TaskType): void {
  if (!stats) {
    throw new Error("Stats not initialized.");
  }

  in_progress_tasks.set(taskId, [taskType, new Date()]);
  stats.tasks.in_progress += 1;

  workerMetricsHandle?.recordTaskStart(taskId.toHexString(), taskType);
}

/** Maps a `TaskFinishedReason` to the Prometheus `WorkerOutcome` label value. */
const REASON_TO_OUTCOME: Record<TaskFinishedReason, import("../metrics/worker.js").WorkerOutcome> = {
  COMPLETED: "successful",
  FAILED: "failed",
  TIMEOUT: "timed_out",
};

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

    const taskDurationMs = new Date().getTime() - startTime.getTime();
    const totalCompletedTasks = stats.tasks.successful + stats.tasks.failed + stats.tasks.timed_out;

    stats.tasks.average_time_ms += (taskDurationMs - stats.tasks.average_time_ms) / totalCompletedTasks;

    stats.tasks.in_progress -= 1;

    workerMetricsHandle?.recordTaskFinish(
      taskId.toHexString(),
      taskDurationMs / 1000,
      REASON_TO_OUTCOME[reason],
    );
  }
}

export function getStats(): Stats {
  if (!stats) {
    throw new Error("Stats not initialized.");
  }

  return stats;
}
