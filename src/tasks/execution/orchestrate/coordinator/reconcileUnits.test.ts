import { describe, it, expect, vi, beforeEach } from "vitest";
import { Collection, ObjectId } from "mongodb";
import type { Worker } from "worker_threads";

const orchestrateUnits = vi.fn();
vi.mock("./orchestrateUnits.js", () => ({
  orchestrateUnits: (...a: unknown[]) => orchestrateUnits(...a),
}));

import { reconcileUnits } from "./reconcileUnits.js";
import type { OrchestrateHandlers } from "../types.js";
import type { TaskDocument, TxRecord } from "../../../../types/index.js";

const handlers: OrchestrateHandlers = { onConfirmed: vi.fn(), onError: vi.fn() };
const tasks = {} as unknown as Collection<TaskDocument>;
const fakeWorker = {} as unknown as Worker;

const record = (unit: number): TxRecord => ({
  unit,
  signature: "",
  lastValidBlockHeight: 0,
  status: "CONFIRMED",
});

function run(overrides: Partial<Parameters<typeof reconcileUnits>[0]> = {}) {
  const makeWorker = vi.fn(() => fakeWorker);
  const promise = reconcileUnits({
    tasks,
    taskId: new ObjectId(),
    existing: [],
    target: 10,
    signal: new AbortController().signal,
    handlers,
    makeWorker,
    ...overrides,
  });
  return { promise, makeWorker };
}

describe("reconcileUnits", () => {
  beforeEach(() => orchestrateUnits.mockReset());

  it("tops up only the shortfall, numbering fresh units after the resumed ones", async () => {
    orchestrateUnits
      .mockResolvedValueOnce({ confirmed: 3, errored: 0, aborted: false }) // resume
      .mockResolvedValueOnce({ confirmed: 7, errored: 0, aborted: false }); // top-up

    const { promise, makeWorker } = run({ existing: [record(0), record(1), record(2)], target: 10 });
    const result = await promise;

    // needed = target(10) - resumed-confirmed(3) = 7; startUnit = existing.length = 3
    expect(makeWorker).toHaveBeenCalledWith(7, 3);
    expect(result).toEqual({ confirmed: 10, errored: 0, aborted: false });
  });

  it("does not spawn a worker when the target is already met", async () => {
    orchestrateUnits.mockResolvedValueOnce({ confirmed: 10, errored: 0, aborted: false });

    const { promise, makeWorker } = run({ existing: [record(0)], target: 10 });
    const result = await promise;

    expect(makeWorker).not.toHaveBeenCalled();
    expect(orchestrateUnits).toHaveBeenCalledOnce(); // resume only
    expect(result.confirmed).toBe(10);
  });

  it("short-circuits (no top-up) when the resume is aborted", async () => {
    orchestrateUnits.mockResolvedValueOnce({ confirmed: 2, errored: 0, aborted: true });

    const { promise, makeWorker } = run({ existing: [record(0)], target: 10 });
    const result = await promise;

    expect(makeWorker).not.toHaveBeenCalled();
    expect(result.aborted).toBe(true);
  });

  it("with no prior records, signs the full target starting at unit 0", async () => {
    orchestrateUnits.mockResolvedValueOnce({ confirmed: 10, errored: 0, aborted: false });

    const { promise, makeWorker } = run({ existing: [], target: 10 });
    await promise;

    expect(makeWorker).toHaveBeenCalledWith(10, 0);
    expect(orchestrateUnits).toHaveBeenCalledOnce(); // no resume call, just top-up
  });
});
