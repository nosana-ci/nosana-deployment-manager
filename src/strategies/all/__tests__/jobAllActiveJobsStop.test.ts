import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";

import { jobAllActiveJobsStop } from "../jobAllActiveJobsStop.js";
import { NosanaCollections } from "../../../definitions/collection.js";
import {
  DeploymentStatus,
  DeploymentStrategy,
  JobState,
  TaskType,
  type JobsDocument,
} from "../../../types/index.js";

const [, handler] = jobAllActiveJobsStop;

const tasks = { deleteMany: vi.fn(), countDocuments: vi.fn() };
const jobs = { countDocuments: vi.fn() };
const deployments = { findOne: vi.fn(), updateOne: vi.fn() };
const db = {
  collection: (name: string) =>
    ({
      [NosanaCollections.TASKS]: tasks,
      [NosanaCollections.JOBS]: jobs,
      [NosanaCollections.DEPLOYMENTS]: deployments,
    })[name],
} as unknown as Db;

const job = { job: "j1", deployment: "dep-1", state: JobState.STOPPED } as JobsDocument;

const deployment = (over: Record<string, unknown> = {}) => ({
  id: "dep-1",
  strategy: DeploymentStrategy.SIMPLE,
  status: DeploymentStatus.RUNNING,
  ...over,
});

beforeEach(() => {
  tasks.deleteMany.mockReset().mockResolvedValue({ acknowledged: true });
  tasks.countDocuments.mockReset().mockResolvedValue(0);
  jobs.countDocuments.mockReset().mockResolvedValue(0);
  deployments.findOne.mockReset().mockResolvedValue(deployment());
  deployments.updateOne.mockReset().mockResolvedValue({ acknowledged: true });
});

describe("jobAllActiveJobsStop", () => {
  it("drops the settled job's own pending tasks", async () => {
    await handler(job, db);

    expect(tasks.deleteMany).toHaveBeenCalledWith({ deploymentId: "dep-1", job: { $eq: "j1" } });
  });

  it("flips a RUNNING SIMPLE deployment to STOPPED once nothing is active and nothing is queued to list", async () => {
    await handler(job, db);

    expect(tasks.countDocuments).toHaveBeenCalledWith({ deploymentId: "dep-1", task: TaskType.LIST });
    expect(deployments.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ id: "dep-1" }),
      { $set: { status: DeploymentStatus.STOPPED } }
    );
  });

  it("keeps a RUNNING deployment RUNNING while a LIST is still queued or in flight", async () => {
    tasks.countDocuments.mockResolvedValue(1);

    await handler(job, db);

    expect(deployments.updateOne).not.toHaveBeenCalled();
  });

  it("still settles a STOPPING deployment to STOPPED regardless of queued lists", async () => {
    deployments.findOne.mockResolvedValue(deployment({ status: DeploymentStatus.STOPPING }));
    tasks.countDocuments.mockResolvedValue(1);

    await handler(job, db);

    expect(tasks.countDocuments).not.toHaveBeenCalled();
    expect(deployments.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ id: "dep-1" }),
      { $set: { status: DeploymentStatus.STOPPED } }
    );
  });

  it("leaves the deployment alone while jobs are still active", async () => {
    jobs.countDocuments.mockResolvedValue(2);

    await handler(job, db);

    expect(deployments.updateOne).not.toHaveBeenCalled();
  });

  it("never touches a RUNNING INFINITE deployment (its own strategy refills)", async () => {
    deployments.findOne.mockResolvedValue(deployment({ strategy: DeploymentStrategy.INFINITE }));

    await handler(job, db);

    expect(jobs.countDocuments).not.toHaveBeenCalled();
    expect(deployments.updateOne).not.toHaveBeenCalled();
  });
});
