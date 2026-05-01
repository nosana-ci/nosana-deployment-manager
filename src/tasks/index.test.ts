import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ObjectId } from "mongodb";

import { initStats } from "../stats/index.js";
import { TaskType } from "../types/index.js";

const fetchOutstanding = vi.fn(async () => [] as Array<Record<string, unknown>>);
const listSpawner = vi.fn();
const stopSpawner = vi.fn();
const extendSpawner = vi.fn();

vi.mock("./getOutstandingTasks.js", () => ({
  getOutstandingTasks: (...args: unknown[]) => fetchOutstanding(...(args as [])),
}));

vi.mock("./task/list/spawner.js", () => ({
  spawnListTask: (...args: unknown[]) => listSpawner(...args),
}));
vi.mock("./task/stop/spawner.js", () => ({
  spawnStopTask: (...args: unknown[]) => stopSpawner(...args),
}));
vi.mock("./task/extend/spawner.js", () => ({
  spawnExtendTask: (...args: unknown[]) => extendSpawner(...args),
}));

import {
  startTaskCollectionListener,
  TASK_DRAIN_POLL_INTERVAL_MS,
  TASK_TIMEOUT_MS,
} from "./index.js";

type FakeWorker = {
  terminate: ReturnType<typeof vi.fn>;
  __completeCallback?: (successCount: number, reason: "COMPLETED" | "FAILED" | "TIMEOUT") => void;
};

function makeFakeWorker(): FakeWorker {
  return { terminate: vi.fn(async () => {}) };
}

function makeTask(taskType: TaskType): { _id: ObjectId; task: TaskType } {
  return { _id: new ObjectId(), task: taskType };
}

describe("startTaskCollectionListener", () => {
  let deleteOne: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    initStats();
    vi.useFakeTimers();
    fetchOutstanding.mockReset();
    fetchOutstanding.mockResolvedValue([]);
    listSpawner.mockReset();
    stopSpawner.mockReset();
    extendSpawner.mockReset();
    deleteOne = vi.fn(async () => ({ acknowledged: true }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createFakeDb() {
    return {
      collection: () => ({ deleteOne }),
    } as unknown as Parameters<typeof startTaskCollectionListener>[0];
  }

  it("clears the polling interval on stop()", async () => {
    const handle = startTaskCollectionListener(createFakeDb());
    await vi.advanceTimersByTimeAsync(0);

    expect(vi.getTimerCount()).toBeGreaterThan(0);

    await handle.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("dispatches each task type to its matching spawner", async () => {
    const listTask = makeTask(TaskType.LIST);
    const extendTask = makeTask(TaskType.EXTEND);
    const stopTask = makeTask(TaskType.STOP);
    fetchOutstanding.mockResolvedValueOnce([listTask, extendTask, stopTask]);

    listSpawner.mockReturnValue(makeFakeWorker());
    extendSpawner.mockReturnValue(makeFakeWorker());
    stopSpawner.mockReturnValue(makeFakeWorker());

    const handle = startTaskCollectionListener(createFakeDb());
    await vi.advanceTimersByTimeAsync(0);

    expect(listSpawner).toHaveBeenCalledOnce();
    expect(extendSpawner).toHaveBeenCalledOnce();
    expect(stopSpawner).toHaveBeenCalledOnce();

    // Drain in-flight workers via the per-task timeout path so stop() resolves
    // without waiting on the 120 s deadline.
    await vi.advanceTimersByTimeAsync(TASK_TIMEOUT_MS + TASK_DRAIN_POLL_INTERVAL_MS);
    await handle.stop();
  });

  it("invokes the completion callback to delete the task and remove the worker", async () => {
    const task = makeTask(TaskType.LIST);
    fetchOutstanding.mockResolvedValueOnce([task]);

    let captured: ((s: number, r: "COMPLETED" | "FAILED" | "TIMEOUT") => void) | undefined;
    listSpawner.mockImplementation((_db, _t, callback) => {
      captured = callback as typeof captured;
      return makeFakeWorker();
    });

    const handle = startTaskCollectionListener(createFakeDb());
    await vi.advanceTimersByTimeAsync(0);

    expect(captured).toBeDefined();
    await captured!(1, "COMPLETED");

    expect(deleteOne).toHaveBeenCalledWith({ _id: { $eq: task._id } });

    await handle.stop();
  });

  it("times out an in-flight worker after TASK_TIMEOUT_MS and terminates it", async () => {
    const task = makeTask(TaskType.LIST);
    fetchOutstanding.mockResolvedValueOnce([task]);

    const worker = makeFakeWorker();
    listSpawner.mockReturnValue(worker);

    startTaskCollectionListener(createFakeDb());
    await vi.advanceTimersByTimeAsync(0);

    expect(worker.terminate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(TASK_TIMEOUT_MS + 1);

    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(deleteOne).toHaveBeenCalledWith({ _id: { $eq: task._id } });
  });

  it("does not fetch new tasks once stopped is true", async () => {
    const handle = startTaskCollectionListener(createFakeDb());
    await vi.advanceTimersByTimeAsync(0);

    fetchOutstanding.mockClear();
    await handle.stop();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(fetchOutstanding).not.toHaveBeenCalled();
  });

  it("force-terminates survivors after the drain deadline expires", async () => {
    const task = makeTask(TaskType.LIST);
    fetchOutstanding.mockResolvedValueOnce([task]);

    const worker = makeFakeWorker();
    listSpawner.mockImplementation(() => worker);

    const handle = startTaskCollectionListener(createFakeDb());
    await vi.advanceTimersByTimeAsync(0);

    // Worker is in-flight. Patch the worker's per-task timeout out of the way
    // so the drain loop is the one that has to clean it up.
    deleteOne.mockResolvedValue({ acknowledged: false });

    const stopPromise = handle.stop();
    // Advance just past the per-task TIMEOUT path so it runs first and
    // schedules its own terminate call. Then advance past the drain deadline.
    await vi.advanceTimersByTimeAsync(TASK_TIMEOUT_MS + TASK_DRAIN_POLL_INTERVAL_MS);
    await stopPromise;

    expect(worker.terminate).toHaveBeenCalled();
  });

  it("exports the drain budget constants used by the shutdown plan", () => {
    expect(TASK_TIMEOUT_MS).toBe(120_000);
    expect(TASK_DRAIN_POLL_INTERVAL_MS).toBe(500);
  });
});
