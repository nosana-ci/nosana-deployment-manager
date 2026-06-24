import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ObjectId } from "mongodb";

import { initStats } from "../../../stats/index.js";
import { TaskStatus, TaskType, TaskRunResult } from "../../../types/index.js";

const claimTasks = vi.fn();
const enrichClaimedTasks = vi.fn();
const runListTask = vi.fn();
const runStopTask = vi.fn();
const runExtendTask = vi.fn();
const acquireDeploymentLock = vi.fn();
const releaseDeploymentLock = vi.fn(async () => {});

vi.mock("../claim/index.js", () => ({
  claimTasks: (...args: unknown[]) => claimTasks(...args),
  enrichClaimedTasks: (...args: unknown[]) => enrichClaimedTasks(...args),
}));
vi.mock("../../task/list/run.js", () => ({ runListTask: (...a: unknown[]) => runListTask(...a) }));
vi.mock("../../task/stop/run.js", () => ({ runStopTask: (...a: unknown[]) => runStopTask(...a) }));
vi.mock("../../task/extend/run.js", () => ({
  runExtendTask: (...a: unknown[]) => runExtendTask(...a),
}));
vi.mock("../lock/index.js", () => ({
  getDeploymentLocks: () => ({}),
  acquireDeploymentLock: (...a: unknown[]) => acquireDeploymentLock(...a),
  releaseDeploymentLock: (...a: unknown[]) => releaseDeploymentLock(...a),
}));
vi.mock("../../../repositories/index.js", () => ({
  getRepository: (name: string) => ({
    collection:
      name === "deployments"
        ? { updateOne: (...a: unknown[]) => deploymentsUpdateOne(...a) }
        : {
            deleteOne: (...a: unknown[]) => deleteOne(...a),
            updateOne: (...a: unknown[]) => updateOne(...a),
            deleteMany: vi.fn(async () => ({})),
          },
  }),
}));

import { startTaskCollectionListener, FETCH_INTERVAL_MS } from "./index.js";

let deleteOne: ReturnType<typeof vi.fn>;
let updateOne: ReturnType<typeof vi.fn>;
let deploymentsUpdateOne: ReturnType<typeof vi.fn>;

// The consumer now reads its collections from the repository singleton (mocked
// above); `db` is passed through but unused, so a minimal stub suffices.
function createFakeDb() {
  return {} as unknown as Parameters<typeof startTaskCollectionListener>[0];
}

function baseTask(task: TaskType, attempts = 1) {
  return { _id: new ObjectId(), task, attempts, deploymentId: "dep-1", status: TaskStatus.PROCESSING };
}

const flush = async () => {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
};

describe("startTaskCollectionListener", () => {
  beforeEach(() => {
    initStats();
    vi.useFakeTimers();
    claimTasks.mockReset().mockResolvedValue([]);
    enrichClaimedTasks.mockReset().mockResolvedValue([]);
    runListTask.mockReset().mockResolvedValue({ outcome: "COMPLETED", successCount: 1 } as TaskRunResult);
    runStopTask.mockReset().mockResolvedValue({ outcome: "COMPLETED", successCount: 0 } as TaskRunResult);
    runExtendTask.mockReset().mockResolvedValue({ outcome: "COMPLETED", successCount: 1 } as TaskRunResult);
    acquireDeploymentLock.mockReset().mockResolvedValue(true);
    releaseDeploymentLock.mockReset().mockResolvedValue(undefined);
    deleteOne = vi.fn(async () => ({ acknowledged: true, deletedCount: 1 }));
    updateOne = vi.fn(async () => ({ acknowledged: true }));
    deploymentsUpdateOne = vi.fn(async () => ({ acknowledged: true }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("claims, enriches and dispatches each task to its matching runner", async () => {
    const listTask = baseTask(TaskType.LIST);
    const stopTask = baseTask(TaskType.STOP);
    const extendTask = baseTask(TaskType.EXTEND);
    claimTasks.mockResolvedValueOnce([listTask, stopTask, extendTask]);
    enrichClaimedTasks.mockResolvedValueOnce([listTask, stopTask, extendTask]);

    const handle = startTaskCollectionListener(createFakeDb());
    await flush();

    expect(runListTask).toHaveBeenCalledOnce();
    expect(runStopTask).toHaveBeenCalledOnce();
    expect(runExtendTask).toHaveBeenCalledOnce();

    await handle.stop();
  });

  it("deletes the task on terminal completion, fenced on the lease holder", async () => {
    const task = baseTask(TaskType.LIST);
    claimTasks.mockResolvedValueOnce([task]);
    enrichClaimedTasks.mockResolvedValueOnce([task]);

    const handle = startTaskCollectionListener(createFakeDb());
    await flush();

    expect(deleteOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: task._id, claimed_by: expect.any(String) })
    );
    expect(releaseDeploymentLock).toHaveBeenCalled();

    await handle.stop();
  });

  it("leaves the task in place (no delete) when a run is aborted", async () => {
    const task = baseTask(TaskType.LIST);
    claimTasks.mockResolvedValueOnce([task]);
    enrichClaimedTasks.mockResolvedValueOnce([task]);
    runListTask.mockResolvedValueOnce({ outcome: "ABORTED", successCount: 0 });

    const handle = startTaskCollectionListener(createFakeDb());
    await flush();

    expect(deleteOne).not.toHaveBeenCalled();
    expect(releaseDeploymentLock).toHaveBeenCalled();

    await handle.stop();
  });

  it("abandons a task that exceeds the crash-loop attempts cap", async () => {
    const task = baseTask(TaskType.LIST, 99);
    claimTasks.mockResolvedValueOnce([task]);

    const handle = startTaskCollectionListener(createFakeDb());
    await flush();

    expect(deleteOne).toHaveBeenCalledWith({ _id: { $eq: task._id } });
    expect(deploymentsUpdateOne).toHaveBeenCalledWith(
      { id: task.deploymentId },
      { $set: { status: "ERROR" } }
    );
    expect(runListTask).not.toHaveBeenCalled();

    await handle.stop();
  });

  it("reschedules an in-flight RETRY without deleting, and undoes the crash attempt", async () => {
    const task = baseTask(TaskType.LIST);
    claimTasks.mockResolvedValueOnce([task]);
    enrichClaimedTasks.mockResolvedValueOnce([task]);
    runListTask.mockResolvedValueOnce({ outcome: "RETRY", successCount: 0, retryAfterMs: 7000 });

    const handle = startTaskCollectionListener(createFakeDb());
    await flush();

    expect(deleteOne).not.toHaveBeenCalled(); // not terminal — comes back
    expect(updateOne).toHaveBeenCalledWith(
      { _id: task._id, claimed_by: expect.any(String) },
      expect.objectContaining({
        $set: expect.objectContaining({ status: TaskStatus.PENDING }),
        $inc: { attempts: -1, inflight_retries: 1 }, // legitimate wait, not a crash
      })
    );
    expect(releaseDeploymentLock).toHaveBeenCalled();

    await handle.stop();
  });

  it("abandons a task that exceeds the in-flight retry cap (distinct from the crash cap)", async () => {
    const task = { ...baseTask(TaskType.LIST), inflight_retries: 99 };
    claimTasks.mockResolvedValueOnce([task]);

    const handle = startTaskCollectionListener(createFakeDb());
    await flush();

    expect(deleteOne).toHaveBeenCalledWith({ _id: { $eq: task._id } });
    expect(deploymentsUpdateOne).toHaveBeenCalledWith(
      { id: task.deploymentId },
      { $set: { status: "ERROR" } }
    );
    expect(runListTask).not.toHaveBeenCalled();

    await handle.stop();
  });

  it("returns a task to PENDING when the deployment lock is contended", async () => {
    const task = baseTask(TaskType.LIST);
    claimTasks.mockResolvedValueOnce([task]);
    enrichClaimedTasks.mockResolvedValueOnce([task]);
    acquireDeploymentLock.mockResolvedValueOnce(false);

    const handle = startTaskCollectionListener(createFakeDb());
    await flush();

    expect(runListTask).not.toHaveBeenCalled();
    expect(updateOne).toHaveBeenCalledWith(
      { _id: { $eq: task._id } },
      expect.objectContaining({
        $set: expect.objectContaining({ status: TaskStatus.PENDING }),
        $unset: expect.objectContaining({ claimed_by: "" }),
      })
    );

    await handle.stop();
  });

  it("counts the attempt with a post-lock increment before dispatch", async () => {
    const task = baseTask(TaskType.LIST);
    claimTasks.mockResolvedValueOnce([task]);
    enrichClaimedTasks.mockResolvedValueOnce([task]);

    const handle = startTaskCollectionListener(createFakeDb());
    await flush();

    expect(updateOne).toHaveBeenCalledWith(
      { _id: task._id, claimed_by: expect.any(String) },
      { $inc: { attempts: 1 } }
    );
    expect(runListTask).toHaveBeenCalledOnce();

    await handle.stop();
  });

  it("clears the polling interval on stop()", async () => {
    const handle = startTaskCollectionListener(createFakeDb());
    await flush();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await handle.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops fetching once stopped", async () => {
    const handle = startTaskCollectionListener(createFakeDb());
    await flush();
    await handle.stop();
    claimTasks.mockClear();
    await vi.advanceTimersByTimeAsync(FETCH_INTERVAL_MS * 2);
    expect(claimTasks).not.toHaveBeenCalled();
  });
});
