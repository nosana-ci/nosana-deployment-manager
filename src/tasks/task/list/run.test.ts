import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

import { DeploymentStrategy } from "../../../types/index.js";
import type { OutstandingTasksDocument } from "../../../types/index.js";

const reconcileUnits = vi.fn();
const tasksUpdateOne = vi.fn(async () => ({ acknowledged: true }));
const onListExit = vi.fn(async () => {});

vi.mock("../../execution/orchestrate/index.js", () => ({
  reconcileUnits: (...a: unknown[]) => reconcileUnits(...a),
}));
vi.mock("../../../repositories/index.js", () => ({
  getRepository: () => ({ collection: { updateOne: (...a: unknown[]) => tasksUpdateOne(...a) } }),
}));
vi.mock("../../../worker/Worker.js", () => ({ VaultWorker: vi.fn() }));
vi.mock("./events/index.js", () => ({
  onListConfirmed: vi.fn(),
  // Mirror the real handler's relevant behaviour: flag the run as retryable.
  onListError: (
    _events: unknown,
    _task: unknown,
    error: string,
    setRetrySignal: (signal: { insufficientFunds: boolean }) => void
  ) => setRetrySignal({ insufficientFunds: String(error).includes("InsufficientFundsForRent") }),
  onListExit: (...a: unknown[]) => onListExit(...a),
}));

import { runListTask } from "./run.js";

function makeTask(over: {
  target_count?: number;
  replicas: number;
  strategy?: string;
  jobs?: unknown[];
}): OutstandingTasksDocument {
  return {
    _id: new ObjectId(),
    deploymentId: "dep-1",
    target_count: over.target_count,
    transactions: [],
    jobs: over.jobs ?? [],
    deployment: {
      replicas: over.replicas,
      strategy: over.strategy ?? "SIMPLE",
      vault: { vault_key: "k" },
      active_revision: 1,
      market: "m",
    },
  } as unknown as OutstandingTasksDocument;
}

describe("runListTask target", () => {
  beforeEach(() => {
    reconcileUnits.mockReset().mockResolvedValue({ confirmed: 5, errored: 0, aborted: false });
    tasksUpdateOne.mockReset().mockResolvedValue({ acknowledged: true });
    onListExit.mockReset().mockResolvedValue(undefined);
  });

  it("uses the persisted target_count on reclaim and does NOT recompute from live replicas", async () => {
    // target_count frozen at 5, but the (reloaded) deployment now says 20 replicas.
    const task = makeTask({ target_count: 5, replicas: 20 });

    await runListTask(task, new AbortController().signal);

    expect(reconcileUnits).toHaveBeenCalledWith(expect.objectContaining({ target: 5 }));
    expect(tasksUpdateOne).not.toHaveBeenCalled(); // already frozen — no re-persist
  });

  it("computes and persists target_count from replicas on the first attempt", async () => {
    const task = makeTask({ replicas: 8, strategy: DeploymentStrategy.SIMPLE, jobs: [] });

    await runListTask(task, new AbortController().signal);

    expect(tasksUpdateOne).toHaveBeenCalledWith({ _id: task._id }, { $set: { target_count: 8 } });
    expect(reconcileUnits).toHaveBeenCalledWith(expect.objectContaining({ target: 8 }));
  });

  it("reschedules (RETRY) instead of failing terminally on a handled error", async () => {
    reconcileUnits.mockImplementation(async ({ handlers }: { handlers: { onError: (u: number, e: string) => void } }) => {
      await handlers.onError(0, "Transaction simulation failed");
      return { confirmed: 0, errored: 1, aborted: false, retry: false };
    });
    const task = makeTask({ target_count: 1, replicas: 1 });

    const result = await runListTask(task, new AbortController().signal);

    expect(result.outcome).toBe("RETRY");
    expect(result.retryAfterMs).toBeGreaterThan(0);
    expect(onListExit).not.toHaveBeenCalled(); // no terminal side effects on a retry
  });

  it("honours the CM Retry-After cadence for an in-flight RETRY (no escalation)", async () => {
    reconcileUnits.mockResolvedValue({ confirmed: 0, errored: 0, aborted: false, retry: true, retryAfterMs: 2000 });
    const task = makeTask({ target_count: 1, replicas: 1 });

    const result = await runListTask(task, new AbortController().signal);

    expect(result.outcome).toBe("RETRY");
    expect(result.retryAfterMs).toBe(2000); // CM cadence honoured, not floored to the error ladder
  });
});
