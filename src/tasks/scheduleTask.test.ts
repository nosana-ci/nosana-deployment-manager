import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";

import { DeploymentStatus, TaskType } from "../types/index.js";

const insertOne = vi.fn();
const updateOne = vi.fn();
const deploymentsUpdateOne = vi.fn();

vi.mock("../repositories/index.js", () => ({
  getRepository: (name: string) => ({
    collection:
      name === "deployments"
        ? { updateOne: (...a: unknown[]) => deploymentsUpdateOne(...a) }
        : { insertOne: (...a: unknown[]) => insertOne(...a), updateOne: (...a: unknown[]) => updateOne(...a) },
  }),
}));

import { scheduleTask } from "./scheduleTask.js";

const db = {} as Db;

beforeEach(() => {
  insertOne.mockReset().mockResolvedValue({ acknowledged: true });
  updateOne.mockReset().mockResolvedValue({ upsertedCount: 1 });
  deploymentsUpdateOne.mockReset().mockResolvedValue({});
});

describe("scheduleTask", () => {
  it("default: inserts unconditionally and reports a task was created", async () => {
    const created = await scheduleTask(db, TaskType.LIST, "dep-1", DeploymentStatus.RUNNING);

    expect(created).toBe(true);
    expect(insertOne).toHaveBeenCalledOnce();
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("idempotent: upserts keyed by (task, deployment, job, PENDING) and creates when absent", async () => {
    updateOne.mockResolvedValueOnce({ upsertedCount: 1 });

    const created = await scheduleTask(
      db,
      TaskType.EXTEND,
      "dep-1",
      DeploymentStatus.RUNNING,
      new Date(0),
      { job: "job-1", idempotent: true }
    );

    expect(created).toBe(true);
    expect(insertOne).not.toHaveBeenCalled();
    expect(updateOne).toHaveBeenCalledWith(
      { task: TaskType.EXTEND, deploymentId: "dep-1", status: "PENDING", job: "job-1" },
      { $setOnInsert: expect.objectContaining({ task: TaskType.EXTEND, job: "job-1" }) },
      { upsert: true }
    );
  });

  it("idempotent: a pending task already exists -> no insert, reports not created", async () => {
    updateOne.mockResolvedValueOnce({ upsertedCount: 0 });

    const created = await scheduleTask(
      db,
      TaskType.EXTEND,
      "dep-1",
      DeploymentStatus.RUNNING,
      new Date(0),
      { job: "job-1", idempotent: true }
    );

    expect(created).toBe(false);
  });

  it("does not flip a STARTING deployment to RUNNING when the idempotent insert no-ops", async () => {
    updateOne.mockResolvedValueOnce({ upsertedCount: 0 });

    await scheduleTask(db, TaskType.LIST, "dep-1", DeploymentStatus.STARTING, new Date(0), {
      idempotent: true,
    });

    expect(deploymentsUpdateOne).not.toHaveBeenCalled();
  });
});
