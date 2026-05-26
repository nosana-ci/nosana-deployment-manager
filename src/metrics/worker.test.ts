import { describe, it, expect } from "vitest";

import { createRegistry } from "./registry.js";
import {
  makeWorkerMetrics,
  WORKER_TASK_TYPES,
  WORKER_OUTCOMES,
} from "./worker.js";

describe("makeWorkerMetrics", () => {
  it("increments worker_tasks_in_progress on recordTaskStart", async () => {
    const handle = createRegistry("worker");
    const workerMetrics = makeWorkerMetrics(handle);

    workerMetrics.recordTaskStart("task-a", "LIST");

    const output = await handle.registry.metrics();
    expect(output).toContain('worker_tasks_in_progress{');
    expect(output).toContain('task_type="LIST"');
  });

  it("decrements worker_tasks_in_progress on recordTaskFinish", async () => {
    const handle = createRegistry("worker");
    const workerMetrics = makeWorkerMetrics(handle);

    workerMetrics.recordTaskStart("task-a", "LIST");
    workerMetrics.recordTaskStart("task-a2", "LIST"); // two in-progress
    workerMetrics.recordTaskFinish("task-a", 2.5, "successful"); // one finished, one remains

    const output = await handle.registry.metrics();
    // After finishing one of two in-progress LIST tasks, gauge should be 1.
    // Metric lines include constant labels so we match the pattern flexibly.
    const match = output.match(/worker_tasks_in_progress\{[^}]*task_type="LIST"[^}]*\}\s+(\d+)/m);
    expect(match).not.toBeNull();
    expect(parseInt(match![1], 10)).toBe(1);
  });

  it("increments worker_tasks_total counter on recordTaskFinish", async () => {
    const handle = createRegistry("worker");
    const workerMetrics = makeWorkerMetrics(handle);

    workerMetrics.recordTaskStart("task-b", "EXTEND");
    workerMetrics.recordTaskFinish("task-b", 1.0, "successful");

    const output = await handle.registry.metrics();
    expect(output).toContain('worker_tasks_total{');
    expect(output).toContain('task_type="EXTEND"');
    expect(output).toContain('outcome="successful"');
  });

  it("records a failed outcome in worker_tasks_total", async () => {
    const handle = createRegistry("worker");
    const workerMetrics = makeWorkerMetrics(handle);

    workerMetrics.recordTaskStart("task-c", "STOP");
    workerMetrics.recordTaskFinish("task-c", 0.5, "failed");

    const output = await handle.registry.metrics();
    expect(output).toContain('outcome="failed"');
  });

  it("records a timed_out outcome in worker_tasks_total", async () => {
    const handle = createRegistry("worker");
    const workerMetrics = makeWorkerMetrics(handle);

    workerMetrics.recordTaskStart("task-d", "LIST");
    workerMetrics.recordTaskFinish("task-d", 120, "timed_out");

    const output = await handle.registry.metrics();
    expect(output).toContain('outcome="timed_out"');
  });

  it("observes duration in worker_task_duration_seconds histogram", async () => {
    const handle = createRegistry("worker");
    const workerMetrics = makeWorkerMetrics(handle);

    workerMetrics.recordTaskStart("task-e", "LIST");
    workerMetrics.recordTaskFinish("task-e", 5.0, "successful");

    const output = await handle.registry.metrics();
    expect(output).toContain("worker_task_duration_seconds");
    expect(output).toContain("worker_task_duration_seconds_count");
  });

  it("sets worker_started_at_seconds to a positive epoch value at construction", async () => {
    const nowBefore = Math.floor(Date.now() / 1000);
    const handle = createRegistry("worker");
    const workerMetrics = makeWorkerMetrics(handle);
    const nowAfter = Math.floor(Date.now() / 1000) + 1;

    // Access via metrics output
    const output = await handle.registry.metrics();
    expect(output).toContain("worker_started_at_seconds");

    // The gauge value should be a valid epoch in the expected range
    // Metric line includes constant labels: worker_started_at_seconds{...} <value>
    const match = output.match(/^worker_started_at_seconds\{[^}]*\}\s+(\d+)/m);
    expect(match).not.toBeNull();
    const gaugeValue = parseInt(match![1], 10);
    expect(gaugeValue).toBeGreaterThanOrEqual(nowBefore);
    expect(gaugeValue).toBeLessThanOrEqual(nowAfter);

    void workerMetrics; // suppress unused warning
  });

  it("updates worker_last_task_finished_timestamp_seconds on recordTaskFinish", async () => {
    const handle = createRegistry("worker");
    const workerMetrics = makeWorkerMetrics(handle);
    const beforeFinish = Math.floor(Date.now() / 1000);

    workerMetrics.recordTaskStart("task-f", "STOP");
    workerMetrics.recordTaskFinish("task-f", 3.0, "successful");

    const output = await handle.registry.metrics();
    expect(output).toContain("worker_last_task_finished_timestamp_seconds");

    // Metric line includes constant labels: worker_last_task_finished_timestamp_seconds{...} <value>
    const match = output.match(/^worker_last_task_finished_timestamp_seconds\{[^}]*\}\s+(\d+)/m);
    expect(match).not.toBeNull();
    const gaugeValue = parseInt(match![1], 10);
    expect(gaugeValue).toBeGreaterThanOrEqual(beforeFinish);
  });

  it("is a no-op for recordTaskFinish with unknown task id", async () => {
    const handle = createRegistry("worker");
    const workerMetrics = makeWorkerMetrics(handle);

    // Should not throw
    expect(() =>
      workerMetrics.recordTaskFinish("unknown-id", 1.0, "successful"),
    ).not.toThrow();
  });

  it("all three task types are handled", async () => {
    const handle = createRegistry("worker");
    const workerMetrics = makeWorkerMetrics(handle);

    for (const taskType of WORKER_TASK_TYPES) {
      workerMetrics.recordTaskStart(`task-${taskType}`, taskType);
      workerMetrics.recordTaskFinish(`task-${taskType}`, 1.0, "successful");
    }

    const output = await handle.registry.metrics();
    for (const taskType of WORKER_TASK_TYPES) {
      expect(output).toContain(`task_type="${taskType}"`);
    }
  });

  it("exports the WORKER_OUTCOMES constant with expected values", () => {
    expect(WORKER_OUTCOMES).toContain("successful");
    expect(WORKER_OUTCOMES).toContain("failed");
    expect(WORKER_OUTCOMES).toContain("timed_out");
  });
});
