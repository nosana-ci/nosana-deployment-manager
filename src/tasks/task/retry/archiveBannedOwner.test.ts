import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";

const deploymentsFind = vi.fn();
const deploymentsUpdateMany = vi.fn(async () => ({}));
const tasksDeleteMany = vi.fn(async () => ({}));
const scheduleTask = vi.fn(async () => true);

vi.mock("../../../repositories/index.js", () => ({
  getRepository: (name: string) => ({
    collection:
      name === "deployments"
        ? {
            find: (...a: unknown[]) => deploymentsFind(...a),
            updateMany: (...a: unknown[]) => deploymentsUpdateMany(...a),
          }
        : { deleteMany: (...a: unknown[]) => tasksDeleteMany(...a) },
  }),
}));
vi.mock("../../scheduleTask.js", () => ({
  scheduleTask: (...a: unknown[]) => scheduleTask(...a),
}));

import { archiveBannedOwner } from "./archiveBannedOwner.js";

const db = {} as Db;

describe("archiveBannedOwner", () => {
  beforeEach(() => {
    deploymentsFind.mockReset();
    deploymentsUpdateMany.mockReset();
    tasksDeleteMany.mockReset();
    scheduleTask.mockReset();
    scheduleTask.mockResolvedValue(true);
  });

  it("archives every non-archived deployment of the owner, drops churn, enqueues a STOP each", async () => {
    deploymentsFind.mockReturnValue({
      toArray: async () => [
        { id: "dep-a", status: "RUNNING" },
        { id: "dep-b", status: "STOPPING" },
      ],
    });

    await archiveBannedOwner(db, "owner-1");

    // Owner-scoped, excluding already-archived (idempotent under concurrent tasks).
    expect(deploymentsFind).toHaveBeenCalledWith(
      { owner: "owner-1", status: { $ne: "ARCHIVED" } },
      { projection: { id: 1, status: 1 } }
    );
    // Provisioning churn dropped; in-flight STOP tasks kept.
    expect(tasksDeleteMany).toHaveBeenCalledWith({
      deploymentId: { $in: ["dep-a", "dep-b"] },
      task: { $ne: "STOP" },
    });
    // One idempotent STOP enqueued per deployment (to delist its on-chain jobs).
    expect(scheduleTask).toHaveBeenCalledTimes(2);
    expect(scheduleTask).toHaveBeenCalledWith(db, "STOP", "dep-a", "RUNNING", expect.any(Date), { idempotent: true });
    expect(scheduleTask).toHaveBeenCalledWith(db, "STOP", "dep-b", "STOPPING", expect.any(Date), { idempotent: true });
    // Terminal state applied to the whole account.
    expect(deploymentsUpdateMany).toHaveBeenCalledWith(
      { id: { $in: ["dep-a", "dep-b"] } },
      { $set: { status: "ARCHIVED" } }
    );
  });

  it("is a no-op when the owner has no non-archived deployments", async () => {
    deploymentsFind.mockReturnValue({ toArray: async () => [] });

    await archiveBannedOwner(db, "owner-1");

    expect(tasksDeleteMany).not.toHaveBeenCalled();
    expect(scheduleTask).not.toHaveBeenCalled();
    expect(deploymentsUpdateMany).not.toHaveBeenCalled();
  });
});
