import { describe, it, expect, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

import { initStats, addTaskStat, removeTaskStat, getStats } from "./index.js";
import { TaskType } from "../types/index.js";

describe("stats", () => {
  beforeEach(() => {
    initStats();
  });

  it("getStats returns the initial shape after initStats", () => {
    const stats = getStats();
    expect(stats.started_at).toBeInstanceOf(Date);
    expect(stats.jobs).toEqual({ listed: 0, extended: 0, stopped: 0 });
    expect(stats.tasks).toEqual({
      in_progress: 0,
      failed: 0,
      successful: 0,
      timed_out: 0,
      average_time_ms: 0,
    });
  });

  it("addTaskStat increments in_progress", () => {
    addTaskStat(new ObjectId(), TaskType.LIST);
    addTaskStat(new ObjectId(), TaskType.EXTEND);
    expect(getStats().tasks.in_progress).toBe(2);
  });

  it.each([
    { reason: "COMPLETED" as const, type: TaskType.LIST, jobsField: "listed" as const },
    { reason: "COMPLETED" as const, type: TaskType.EXTEND, jobsField: "extended" as const },
    { reason: "COMPLETED" as const, type: TaskType.STOP, jobsField: "stopped" as const },
  ])(
    "removeTaskStat with COMPLETED reason credits the matching $jobsField counter",
    ({ reason, type, jobsField }) => {
      const id = new ObjectId();
      addTaskStat(id, type);
      removeTaskStat(id, 3, reason);

      const stats = getStats();
      expect(stats.tasks.successful).toBe(1);
      expect(stats.tasks.in_progress).toBe(0);
      expect(stats.jobs[jobsField]).toBe(3);
    },
  );

  it("removeTaskStat with FAILED reason increments tasks.failed", () => {
    const id = new ObjectId();
    addTaskStat(id, TaskType.LIST);
    removeTaskStat(id, 0, "FAILED");

    expect(getStats().tasks.failed).toBe(1);
    expect(getStats().tasks.in_progress).toBe(0);
  });

  it("removeTaskStat with TIMEOUT reason increments tasks.timed_out", () => {
    const id = new ObjectId();
    addTaskStat(id, TaskType.LIST);
    removeTaskStat(id, 0, "TIMEOUT");

    expect(getStats().tasks.timed_out).toBe(1);
    expect(getStats().tasks.in_progress).toBe(0);
  });

  it("removeTaskStat updates average_time_ms across multiple completions", () => {
    const id1 = new ObjectId();
    const id2 = new ObjectId();
    addTaskStat(id1, TaskType.LIST);
    addTaskStat(id2, TaskType.LIST);
    removeTaskStat(id1, 1, "COMPLETED");
    removeTaskStat(id2, 1, "COMPLETED");

    expect(getStats().tasks.average_time_ms).toBeGreaterThanOrEqual(0);
  });

  it("removeTaskStat is a no-op for an unknown task id", () => {
    removeTaskStat(new ObjectId(), 1, "COMPLETED");
    const stats = getStats();
    expect(stats.tasks.in_progress).toBe(0);
    expect(stats.tasks.successful).toBe(0);
    expect(stats.jobs.listed).toBe(0);
  });
});
