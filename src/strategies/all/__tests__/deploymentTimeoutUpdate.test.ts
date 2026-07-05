import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";

const scheduleTask = vi.fn();
vi.mock("../../../tasks/scheduleTask.js", () => ({
  scheduleTask: (...a: unknown[]) => scheduleTask(...a),
}));

const jobsFindAll = vi.fn();
const tasksFindAll = vi.fn();
const bulkWrite = vi.fn();
vi.mock("../../../repositories/index.js", () => ({
  JobsRepository: { findAll: (...a: unknown[]) => jobsFindAll(...a) },
  TasksRepository: {
    findAll: (...a: unknown[]) => tasksFindAll(...a),
    collection: { bulkWrite: (...a: unknown[]) => bulkWrite(...a) },
  },
}));

const jobsGet = vi.fn();
vi.mock("../../../kit/index.js", () => ({
  getKit: () => ({ jobs: { get: (...a: unknown[]) => jobsGet(...a) } }),
}));

// address() is identity for the test — we only need the string round-tripped.
vi.mock("@nosana/kit", () => ({ address: (a: string) => a }));

import { deploymentTimeoutUpdate } from "../deploymentTimeoutUpdate.js";
import {
  DeploymentDocumentFields,
  DeploymentStatus,
  DeploymentStrategy,
  TaskStatus,
  TaskType,
} from "../../../types/index.js";
import { OnEvent } from "../../../client/listener/types.js";

const [eventType, handler, options] = deploymentTimeoutUpdate;
const db = {} as Db;

// New timeout 90m (target 5400s); an INFINITE job at the old 60m (3600s).
const deployment = {
  id: "dep-1",
  status: DeploymentStatus.RUNNING,
  strategy: DeploymentStrategy.INFINITE,
  timeout: 90,
} as never;

beforeEach(() => {
  scheduleTask.mockReset().mockResolvedValue(true);
  jobsFindAll.mockReset().mockResolvedValue([]);
  tasksFindAll.mockReset().mockResolvedValue([]);
  bulkWrite.mockReset().mockResolvedValue({ acknowledged: true });
  jobsGet.mockReset();
});

describe("deploymentTimeoutUpdate — configuration", () => {
  it("is an UPDATE listener keyed on the TIMEOUT field", () => {
    expect(eventType).toBe(OnEvent.UPDATE);
    expect(options?.fields).toEqual([DeploymentDocumentFields.TIMEOUT]);
  });

  it("only fires for RUNNING INFINITE / SIMPLE-EXTEND deployments", () => {
    expect(options?.filters).toEqual({
      strategy: { $in: [DeploymentStrategy.INFINITE, DeploymentStrategy["SIMPLE-EXTEND"]] },
      status: { $eq: DeploymentStatus.RUNNING },
    });
  });
});

describe("deploymentTimeoutUpdate — behavior", () => {
  it("bumps a running job by its on-chain delta and shifts its follow-up in lockstep", async () => {
    jobsFindAll.mockResolvedValueOnce([{ job: "j1" }]);
    jobsGet.mockResolvedValueOnce({ timeout: 3600 }); // current on-chain = 60m
    const dueAt = new Date("2025-01-01T00:00:00Z");
    tasksFindAll.mockResolvedValueOnce([{ _id: "rot-1", due_at: dueAt }]);

    await handler(deployment, db);

    // delta = 5400 - 3600 = 1800s
    expect(scheduleTask).toHaveBeenCalledWith(
      db,
      TaskType.EXTEND,
      "dep-1",
      DeploymentStatus.RUNNING,
      expect.any(Date),
      { job: "j1", extend_seconds: 1800 },
    );

    // follow-up query excludes the one-shot just scheduled
    expect(tasksFindAll).toHaveBeenCalledWith({
      deploymentId: "dep-1",
      job: "j1",
      status: TaskStatus.PENDING,
      tx: null,
      extend_seconds: { $exists: false },
    });
    // rotation LIST pushed forward by exactly the delta
    expect(bulkWrite.mock.calls[0][0]).toEqual([
      {
        updateOne: {
          filter: { _id: "rot-1" },
          update: { $set: { due_at: new Date("2025-01-01T00:30:00Z") } },
        },
      },
    ]);
  });

  it("skips a job whose on-chain timeout is already >= the new target (can't shrink)", async () => {
    jobsFindAll.mockResolvedValueOnce([{ job: "j1" }]);
    jobsGet.mockResolvedValueOnce({ timeout: 7200 }); // 120m >= 90m target

    await handler(deployment, db);

    expect(scheduleTask).not.toHaveBeenCalled();
    expect(bulkWrite).not.toHaveBeenCalled();
  });

  it("extends but does not shift when the job has no pending follow-up", async () => {
    jobsFindAll.mockResolvedValueOnce([{ job: "j1" }]);
    jobsGet.mockResolvedValueOnce({ timeout: 3600 });
    tasksFindAll.mockResolvedValueOnce([]);

    await handler(deployment, db);

    expect(scheduleTask).toHaveBeenCalledOnce();
    expect(bulkWrite).not.toHaveBeenCalled();
  });

  it("skips a job whose on-chain state can't be read (best-effort)", async () => {
    jobsFindAll.mockResolvedValueOnce([{ job: "j1" }]);
    jobsGet.mockRejectedValueOnce(new Error("rpc down"));

    await handler(deployment, db);

    expect(scheduleTask).not.toHaveBeenCalled();
  });

  it("processes each running job independently", async () => {
    jobsFindAll.mockResolvedValueOnce([{ job: "j1" }, { job: "j2" }]);
    jobsGet
      .mockResolvedValueOnce({ timeout: 3600 }) // j1: delta 1800 -> extend
      .mockResolvedValueOnce({ timeout: 5400 }); // j2: delta 0 -> skip
    tasksFindAll.mockResolvedValueOnce([]);

    await handler(deployment, db);

    expect(scheduleTask).toHaveBeenCalledOnce();
    expect(scheduleTask).toHaveBeenCalledWith(
      db,
      TaskType.EXTEND,
      "dep-1",
      DeploymentStatus.RUNNING,
      expect.any(Date),
      { job: "j1", extend_seconds: 1800 },
    );
  });
});
