import { Counter, Gauge, Histogram } from "prom-client";

import type { RegistryHandle } from "./registry.js";

/** The three task types processed by the deployment-manager worker. */
export const WORKER_TASK_TYPES = ["LIST", "EXTEND", "STOP"] as const;
export type WorkerTaskType = (typeof WORKER_TASK_TYPES)[number];

/** The possible outcomes of a completed worker task. */
export const WORKER_OUTCOMES = ["successful", "failed", "timed_out"] as const;
export type WorkerOutcome = (typeof WORKER_OUTCOMES)[number];

export interface WorkerMetrics {
  recordTaskStart(taskId: string, taskType: WorkerTaskType): void;
  recordTaskFinish(
    taskId: string,
    durationSeconds: number,
    outcome: WorkerOutcome,
  ): void;
}

/**
 * Creates and registers worker-specific Prometheus metrics into the given
 * registry handle. Returns a `WorkerMetrics` object for use in
 * `addTaskStat` / `removeTaskStat`.
 *
 * Metrics registered:
 * - `worker_tasks_in_progress{task_type}` gauge
 * - `worker_tasks_total{task_type,outcome}` counter
 * - `worker_task_duration_seconds{task_type}` histogram
 * - `worker_jobs_processed_total{action}` counter (mirrors stats.jobs sub-shape)
 * - `worker_started_at_seconds` gauge (set once at boot)
 * - `worker_last_task_finished_timestamp_seconds` gauge
 */
export function makeWorkerMetrics(handle: RegistryHandle): WorkerMetrics {
  const tasksInProgress = new Gauge({
    name: "worker_tasks_in_progress",
    help: "Number of worker tasks currently in progress",
    labelNames: ["task_type"] as const,
    registers: [handle.registry],
  });

  const tasksTotal = new Counter({
    name: "worker_tasks_total",
    help: "Total worker tasks completed, by type and outcome",
    labelNames: ["task_type", "outcome"] as const,
    registers: [handle.registry],
  });

  const taskDuration = new Histogram({
    name: "worker_task_duration_seconds",
    help: "Worker task duration in seconds",
    labelNames: ["task_type"] as const,
    buckets: [0.5, 1, 5, 10, 30, 60, 300, 600],
    registers: [handle.registry],
  });

  // Mirrors the jobs sub-shape from src/stats/index.ts
  new Counter({
    name: "worker_jobs_processed_total",
    help: "Total jobs processed by the worker, by action",
    labelNames: ["action"] as const,
    registers: [handle.registry],
  });

  const startedAt = new Gauge({
    name: "worker_started_at_seconds",
    help: "Unix timestamp (seconds) when the worker process started",
    registers: [handle.registry],
  });
  startedAt.set(Math.floor(Date.now() / 1000));

  const lastTaskFinished = new Gauge({
    name: "worker_last_task_finished_timestamp_seconds",
    help: "Unix timestamp (seconds) of the last completed worker task",
    registers: [handle.registry],
  });

  // In-progress task tracking: taskId → taskType
  const inProgressMap = new Map<string, WorkerTaskType>();

  return {
    recordTaskStart(taskId: string, taskType: WorkerTaskType): void {
      inProgressMap.set(taskId, taskType);
      tasksInProgress.labels(taskType).inc();
    },

    recordTaskFinish(
      taskId: string,
      durationSeconds: number,
      outcome: WorkerOutcome,
    ): void {
      const taskType = inProgressMap.get(taskId);
      if (!taskType) {
        // No-op for unknown task IDs (defensive; mirrors stats behaviour)
        return;
      }

      inProgressMap.delete(taskId);
      tasksInProgress.labels(taskType).dec();
      tasksTotal.labels(taskType, outcome).inc();
      taskDuration.labels(taskType).observe(durationSeconds);
      lastTaskFinished.set(Math.floor(Date.now() / 1000));
    },
  };
}
