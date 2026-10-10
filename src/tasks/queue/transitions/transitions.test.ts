import { describe, it, expect, vi } from "vitest";
import { Collection, ObjectId, WithId } from "mongodb";

import { DeploymentDocument, TaskDocument, TaskStatus, TaskType } from "../../../types/index.js";
import {
  abandonOverCap,
  abandonInflightExhausted,
  deleteCompletedTask,
  incrementAttempt,
  parkTask,
  releaseTaskToPending,
  rescheduleInflight,
} from "./transitions.js";

function fakeTasks() {
  const deleteTasks = vi.fn(async () => ({ acknowledged: true, deletedCount: 1 }));
  const updateOne = vi.fn(async () => ({ acknowledged: true }));
  return {
    deleteTasks,
    updateOne,
    collection: { updateOne } as unknown as Collection<TaskDocument>,
    /** Deletes go through the tasks repository (it releases deleted LISTs' reservations). */
    repository: { delete: deleteTasks },
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

    await abandonOverCap(tasks.repository, deployments, task);

    expect(tasks.deleteTasks).toHaveBeenCalledWith({ _id: { $eq: task._id } });
    expect(depUpdateOne).toHaveBeenCalledWith(
      { id: "dep-1", status: { $ne: "ARCHIVED" } },
      { $set: { status: "ERROR" } }
    );
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

    await deleteCompletedTask(tasks.repository, id, "consumer-1");

    expect(tasks.deleteTasks).toHaveBeenCalledWith({ _id: id, claimed_by: "consumer-1" });
  });

  it("rescheduleInflight requeues fenced, undoing the crash attempt and bumping inflight_retries", async () => {
    const tasks = fakeTasks();
    const id = new ObjectId();

    await rescheduleInflight(tasks.collection, id, "consumer-1", 7000);

    const [filter, update] = tasks.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: id, claimed_by: "consumer-1" });
    // in-flight wait is NOT a crash: attempts-- (undo this dispatch), inflight_retries++
    expect(update.$inc).toEqual({ attempts: -1, inflight_retries: 1 });
    expect(update.$set.status).toBe(TaskStatus.PENDING);
    expect(update.$unset).toEqual({ claimed_by: "", lease_expires_at: "" });
    // due_at pushed ~7s out (the Retry-After hint)
    expect(update.$set.due_at.getTime()).toBeGreaterThan(Date.now() + 6000);
  });

  it("rescheduleInflight falls back to a default delay when no Retry-After is given", async () => {
    const tasks = fakeTasks();

    await rescheduleInflight(tasks.collection, new ObjectId(), "consumer-1");

    const [, update] = tasks.updateOne.mock.calls[0];
    expect(update.$set.due_at.getTime()).toBeGreaterThan(Date.now() + 1000);
  });

  it("parkTask requeues a waiting LIST until renewal, counting neither an attempt nor an in-flight retry", async () => {
    const tasks = fakeTasks();
    tasks.updateOne.mockResolvedValue({ acknowledged: true, matchedCount: 1 } as never);
    const id = new ObjectId();

    await parkTask(tasks.collection, id, "consumer-1", 840_000);

    expect(tasks.updateOne).toHaveBeenCalledOnce();
    const [filter, update] = tasks.updateOne.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, Record<string, unknown>>];
    // Fenced on the lease and on the pending request a webhook would clear.
    expect(filter).toEqual({ _id: id, claimed_by: "consumer-1", reservation_request: { $exists: true } });
    expect(update.$inc).toEqual({ attempts: -1 }); // undo the dispatch; inflight_retries untouched
    expect(update.$set.status).toBe(TaskStatus.PENDING);
    expect(update.$unset).toEqual({ claimed_by: "", lease_expires_at: "" });
    expect((update.$set.due_at as Date).getTime()).toBeGreaterThan(Date.now() + 839_000);
  });

  it("parkTask releases the task due now when a webhook filled the request mid-run", async () => {
    const tasks = fakeTasks();
    tasks.updateOne
      .mockResolvedValueOnce({ acknowledged: true, matchedCount: 0 } as never) // pending request already cleared
      .mockResolvedValueOnce({ acknowledged: true, matchedCount: 1 } as never);
    const id = new ObjectId();

    await parkTask(tasks.collection, id, "consumer-1", 840_000);

    const [filter, update] = tasks.updateOne.mock.calls[1] as unknown as [Record<string, unknown>, Record<string, Record<string, unknown>>];
    expect(filter).toEqual({ _id: id, claimed_by: "consumer-1" });
    expect(update.$inc).toEqual({ attempts: -1 });
    expect((update.$set.due_at as Date).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("abandonInflightExhausted removes the task and flags the deployment ERROR", async () => {
    const tasks = fakeTasks();
    const depUpdateOne = vi.fn(async () => ({ acknowledged: true }));
    const deployments = { updateOne: depUpdateOne } as unknown as Collection<DeploymentDocument>;
    const task = {
      _id: new ObjectId(),
      task: TaskType.LIST,
      deploymentId: "dep-1",
      inflight_retries: 60,
    } as unknown as WithId<TaskDocument>;

    await abandonInflightExhausted(tasks.repository, deployments, task);

    expect(tasks.deleteTasks).toHaveBeenCalledWith({ _id: { $eq: task._id } });
    expect(depUpdateOne).toHaveBeenCalledWith(
      { id: "dep-1", status: { $ne: "ARCHIVED" } },
      { $set: { status: "ERROR" } }
    );
  });
});
