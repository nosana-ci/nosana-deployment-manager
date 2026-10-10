import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";

const deploymentsFindAll = vi.fn();
const deploymentsUpdateMany = vi.fn(async () => ({}));
const tasksDelete = vi.fn(async () => ({}));
const scheduleTask = vi.fn(async () => true);

vi.mock("../../../repositories/index.js", () => ({
  getRepository: (name: string) =>
    name === "deployments"
      ? {
          findAll: (...a: unknown[]) => deploymentsFindAll(...a),
          collection: { updateMany: (...a: unknown[]) => deploymentsUpdateMany(...a) },
        }
      : { delete: (...a: unknown[]) => tasksDelete(...a) },
}));
vi.mock("../../scheduleTask.js", () => ({
  scheduleTask: (...a: unknown[]) => scheduleTask(...a),
}));

import { archiveBannedOwner } from "./archiveBannedOwner.js";
import { LIST_IN_FLIGHT } from "../../queue/wanted/index.js";

const db = {} as Db;

describe("archiveBannedOwner", () => {
  beforeEach(() => {
    deploymentsFindAll.mockReset();
    deploymentsUpdateMany.mockReset();
    tasksDelete.mockReset();
    scheduleTask.mockReset();
    scheduleTask.mockResolvedValue(true);
  });

  it("archives every non-archived deployment of the owner, drops churn, enqueues a STOP each", async () => {
    deploymentsFindAll.mockResolvedValue([
      { id: "dep-a", status: "RUNNING" },
      { id: "dep-b", status: "STOPPING" },
    ]);

    await archiveBannedOwner(db, "owner-1");

    // Owner-scoped, excluding already-archived (idempotent under concurrent tasks).
    expect(deploymentsFindAll).toHaveBeenCalledWith(
      { owner: "owner-1", status: { $ne: "ARCHIVED" } },
      { projection: { id: 1, status: 1 } }
    );
    // Provisioning churn dropped; in-flight STOP tasks kept.
    // A LIST in flight is spared: it drains, recording the jobs that land so the STOP can delist them.
    expect(tasksDelete).toHaveBeenCalledWith({
      deploymentId: { $in: ["dep-a", "dep-b"] },
      task: { $ne: "STOP" },
      $nor: LIST_IN_FLIGHT,
    });
    // One idempotent STOP enqueued per deployment (to delist its on-chain jobs).
    expect(scheduleTask).toHaveBeenCalledTimes(2);
    expect(scheduleTask).toHaveBeenCalledWith(db, "STOP", "dep-a", "RUNNING", expect.any(Date), { reason: "stop", idempotent: true });
    expect(scheduleTask).toHaveBeenCalledWith(db, "STOP", "dep-b", "STOPPING", expect.any(Date), { reason: "stop", idempotent: true });
    // Terminal state applied to the whole account.
    expect(deploymentsUpdateMany).toHaveBeenCalledWith(
      { id: { $in: ["dep-a", "dep-b"] } },
      { $set: { status: "ARCHIVED" } }
    );
  });

  it("is a no-op when the owner has no non-archived deployments", async () => {
    deploymentsFindAll.mockResolvedValue([]);

    await archiveBannedOwner(db, "owner-1");

    expect(tasksDelete).not.toHaveBeenCalled();
    expect(scheduleTask).not.toHaveBeenCalled();
    expect(deploymentsUpdateMany).not.toHaveBeenCalled();
  });
});
