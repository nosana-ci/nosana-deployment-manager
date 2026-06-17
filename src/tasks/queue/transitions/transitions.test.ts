import { describe, it, expect, vi } from "vitest";
import { Collection, ObjectId, WithId } from "mongodb";

import { DeploymentDocument, TaskDocument, TaskStatus, TaskType } from "../../../types/index.js";
import {
  abandonOverCap,
  deleteCompletedTask,
  incrementAttempt,
  releaseTaskToPending,
} from "./transitions.js";

function fakeTasks() {
  const deleteOne = vi.fn(async () => ({ acknowledged: true, deletedCount: 1 }));
  const updateOne = vi.fn(async () => ({ acknowledged: true }));
  return {
    deleteOne,
    updateOne,
    collection: { deleteOne, updateOne } as unknown as Collection<TaskDocument>,
  };
}

describe("task transitions", () => {
  it("abandonOverCap removes the task and flags the deployment ERROR", async () => {
    const tasks = fakeTasks();
    const depUpdateOne = vi.fn(async () => ({ acknowledged: true }));
    const deployments = { updateOne: depUpdateOne } as unknown as Collection<DeploymentDocument>;
    const task = {
      _id: new ObjectId(),
      task: TaskType.LIST,
      deploymentId: "dep-1",
      attempts: 9,
    } as unknown as WithId<TaskDocument>;

    await abandonOverCap(tasks.collection, deployments, task);

    expect(tasks.deleteOne).toHaveBeenCalledWith({ _id: { $eq: task._id } });
    expect(depUpdateOne).toHaveBeenCalledWith({ id: "dep-1" }, { $set: { status: "ERROR" } });
  });

  it("releaseTaskToPending returns the task to PENDING and clears the lease", async () => {
    const tasks = fakeTasks();
    const id = new ObjectId();

    await releaseTaskToPending(tasks.collection, id);

    expect(tasks.updateOne).toHaveBeenCalledWith(
      { _id: { $eq: id } },
      expect.objectContaining({
        $set: expect.objectContaining({ status: TaskStatus.PENDING }),
        $unset: { claimed_by: "", lease_expires_at: "" },
      })
    );
  });

  it("incrementAttempt bumps attempts fenced on the lease holder", async () => {
    const tasks = fakeTasks();
    const id = new ObjectId();

    await incrementAttempt(tasks.collection, id, "consumer-1");

    expect(tasks.updateOne).toHaveBeenCalledWith(
      { _id: id, claimed_by: "consumer-1" },
      { $inc: { attempts: 1 } }
    );
  });

  it("deleteCompletedTask deletes fenced on the lease holder", async () => {
    const tasks = fakeTasks();
    const id = new ObjectId();

    await deleteCompletedTask(tasks.collection, id, "consumer-1");

    expect(tasks.deleteOne).toHaveBeenCalledWith({ _id: id, claimed_by: "consumer-1" });
  });
});
