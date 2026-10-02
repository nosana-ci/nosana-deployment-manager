import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";

import { DeploymentStrategy } from "../../../types/index.js";
import type { OutstandingTasksDocument, TaskReservation, TxRecord } from "../../../types/index.js";

const order: string[] = [];
const reconcileUnits = vi.fn();
type Write = (...a: unknown[]) => Promise<{ acknowledged: boolean }>;
const tasksUpdateOne = vi.fn<Write>(async () => ({ acknowledged: true }));
const deploymentsUpdateOne = vi.fn<Write>(async () => ({ acknowledged: true }));
const eventsInsertOne = vi.fn<Write>(async () => ({ acknowledged: true }));
const onListExit = vi.fn(async () => {});
const onListConfirmed = vi.fn();
const reserve = vi.fn();
const vaultKey = { value: "solana-secret-key" };

vi.mock("../../execution/orchestrate/index.js", () => ({
  reconcileUnits: (...a: unknown[]) => reconcileUnits(...a),
}));
vi.mock("../../../repositories/index.js", () => ({
  getRepository: (name: string) => ({
    collection:
      name === "events"
        ? { insertOne: (...a: unknown[]) => eventsInsertOne(...a) }
        : name === "deployments"
          ? { updateOne: (...a: unknown[]) => deploymentsUpdateOne(...a) }
          : {
            updateOne: (...a: unknown[]) => {
              order.push("persist");
              return tasksUpdateOne(...a);
            },
          },
  }),
}));
vi.mock("../../../worker/Worker.js", () => ({
  VaultWorker: vi.fn(function () {
    order.push("spawn");
  }),
  workerErrorFormatter: (error: unknown) => String(error),
}));
vi.mock("../../../vault/decrypt.js", () => ({
  decryptWithKey: () => vaultKey.value,
}));
vi.mock("../../../client/hostManager/index.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reserve: (...a: unknown[]) => reserve(...a),
}));
const resolveListDefinitionHash = vi.fn(() => "QmDefinition");
vi.mock("./resolveDefinitionHash.js", () => ({
  resolveListDefinitionHash: (...a: unknown[]) => resolveListDefinitionHash(...a),
}));
const onListError = vi.fn(
  (
    _events: unknown,
    _task: unknown,
    error: string,
    setRetrySignal: (signal: { insufficientFunds: boolean }) => void
  ) => setRetrySignal({ insufficientFunds: String(error).includes("InsufficientFundsForRent") })
);
vi.mock("./events/index.js", () => ({
  onListConfirmed: (...a: unknown[]) => onListConfirmed(...a),
  // Mirror the real handler's relevant behaviour: flag the run as retryable.
  onListError: (...a: Parameters<typeof onListError>) => onListError(...a),
  onListExit: (...a: unknown[]) => onListExit(...a),
}));

import { HostManagerError } from "../../../client/hostManager/index.js";
import { VaultWorker } from "../../../worker/Worker.js";
import { runListTask } from "./run.js";

// These cases never hit the negative-balance path, so `db` is only a placeholder.
const db = {} as Db;
const signal = () => new AbortController().signal;
const inAMinute = () => new Date(Date.now() + 60_000);

function makeTask(over: {
  target_count?: number;
  ipfs_definition_hash?: string;
  replicas: number;
  strategy?: string;
  jobs?: unknown[];
  market?: string;
  requirements?: Record<string, number | string | boolean> | null;
  reservation?: TaskReservation;
  transactions?: TxRecord[];
}): OutstandingTasksDocument {
  return {
    _id: new ObjectId(),
    deploymentId: "dep-1",
    target_count: over.target_count,
    ipfs_definition_hash: over.ipfs_definition_hash,
    reservation: over.reservation,
    transactions: over.transactions ?? [],
    jobs: over.jobs ?? [],
    deployment: {
      replicas: over.replicas,
      strategy: over.strategy ?? "SIMPLE",
      vault: { vault_key: "k" },
      active_revision: 1,
      market: over.market ?? "m",
      requirements: over.requirements ?? null,
    },
  } as unknown as OutstandingTasksDocument;
}

/** A reconcile with nothing to resume: ask the factory for `target` fresh units. */
function reconcileFresh(result = { confirmed: 0, errored: 0, aborted: false, retry: false }) {
  reconcileUnits.mockImplementation(
    async ({ makeWorker, target }: { makeWorker: (count: number, startUnit: number) => unknown; target: number }) => {
      await makeWorker(target, 0);
      return result;
    }
  );
}

function reserved(nodes: { nodeAddress: string; market: string }[], requested = nodes.length) {
  return { requested, reserved: nodes.length, expiresAt: nodes.length ? inAMinute().toISOString() : null, nodes };
}

const spawnedWorkerData = () =>
  vi.mocked(VaultWorker).mock.calls.map(([, options]) => (options as { workerData: Record<string, unknown> }).workerData);

const spawnedNodes = () => spawnedWorkerData().map((data) => data.nodes);

const eventTypes = () => eventsInsertOne.mock.calls.map(([event]) => (event as { type: string }).type);

beforeEach(() => {
  order.length = 0;
  reconcileUnits.mockReset().mockResolvedValue({ confirmed: 5, errored: 0, aborted: false });
  tasksUpdateOne.mockReset().mockResolvedValue({ acknowledged: true });
  deploymentsUpdateOne.mockReset().mockResolvedValue({ acknowledged: true });
  eventsInsertOne.mockReset().mockResolvedValue({ acknowledged: true });
  onListExit.mockReset().mockResolvedValue(undefined);
  onListConfirmed.mockReset();
  onListError.mockClear();
  reserve.mockReset();
  vi.mocked(VaultWorker).mockClear();
  resolveListDefinitionHash.mockReset().mockReturnValue("QmDefinition");
  vaultKey.value = "solana-secret-key";
});

describe("runListTask target", () => {
  it("hands the frozen definition hash to the signer worker", async () => {
    reserve.mockResolvedValue(reserved([{ nodeAddress: "n1", market: "m" }]));
    reconcileFresh();
    const task = makeTask({ target_count: 1, replicas: 1 });

    await runListTask(db, task, signal());

    expect(resolveListDefinitionHash).toHaveBeenCalledWith(task);
    expect(VaultWorker).toHaveBeenCalledWith(
      expect.any(String),
      { workerData: expect.objectContaining({ ipfs_definition_hash: "QmDefinition" }) }
    );
  });

  it("propagates a resolution failure before signing (consumer abandons for reclaim)", async () => {
    resolveListDefinitionHash.mockImplementation(() => {
      throw new Error("Active revision not found");
    });
    const task = makeTask({ target_count: 1, replicas: 1 });

    await expect(runListTask(db, task, signal())).rejects.toThrow("Active revision not found");
    expect(reconcileUnits).not.toHaveBeenCalled();
    expect(onListExit).not.toHaveBeenCalled();
  });

  it("uses the frozen target and hash on reclaim without re-resolving or re-persisting", async () => {
    // target_count frozen at 5, but the (reloaded) deployment now says 20 replicas.
    const task = makeTask({ target_count: 5, ipfs_definition_hash: "QmFrozen", replicas: 20 });

    await runListTask(db, task, signal());

    expect(reconcileUnits).toHaveBeenCalledWith(expect.objectContaining({ target: 5 }));
    expect(resolveListDefinitionHash).not.toHaveBeenCalled();
    expect(tasksUpdateOne).not.toHaveBeenCalled(); // already frozen — no re-persist
  });

  it("computes and persists target and hash in one write on the first attempt", async () => {
    const task = makeTask({ replicas: 8, strategy: DeploymentStrategy.SIMPLE, jobs: [] });

    await runListTask(db, task, signal());

    expect(tasksUpdateOne).toHaveBeenCalledExactlyOnceWith(
      { _id: task._id },
      { $set: { target_count: 8, ipfs_definition_hash: "QmDefinition" } }
    );
    expect(reconcileUnits).toHaveBeenCalledWith(expect.objectContaining({ target: 8 }));
  });

  it("resolves and persists only the missing hash on a task frozen before the hash existed", async () => {
    const task = makeTask({ target_count: 5, replicas: 20 });

    await runListTask(db, task, signal());

    expect(resolveListDefinitionHash).toHaveBeenCalledWith(task);
    expect(tasksUpdateOne).toHaveBeenCalledExactlyOnceWith(
      { _id: task._id },
      { $set: { target_count: 5, ipfs_definition_hash: "QmDefinition" } }
    );
  });

  it("reschedules (RETRY) instead of failing terminally on a handled error", async () => {
    reconcileUnits.mockImplementation(async ({ handlers }: { handlers: { onError: (u: number, e: string) => void } }) => {
      await handlers.onError(0, "Transaction simulation failed");
      return { confirmed: 0, errored: 1, aborted: false, retry: false };
    });
    const task = makeTask({ target_count: 1, replicas: 1 });

    const result = await runListTask(db, task, signal());

    expect(result.outcome).toBe("RETRY");
    expect(result.retryAfterMs).toBeGreaterThan(0);
    expect(onListExit).not.toHaveBeenCalled(); // no terminal side effects on a retry
  });

  it("honours the CM Retry-After cadence for an in-flight RETRY (no escalation)", async () => {
    reconcileUnits.mockResolvedValue({ confirmed: 0, errored: 0, aborted: false, retry: true, retryAfterMs: 2000 });
    const task = makeTask({ target_count: 1, replicas: 1 });

    const result = await runListTask(db, task, signal());

    expect(result.outcome).toBe("RETRY");
    expect(result.retryAfterMs).toBe(2000); // CM cadence honoured, not floored to the error ladder
  });
});

describe("runListTask reservation (self-custody)", () => {
  it("reserves the shortfall under taskId:reserve:0 and persists it before the worker signs", async () => {
    reserve.mockResolvedValue(
      reserved([
        { nodeAddress: "n1", market: "m" },
        { nodeAddress: "n2", market: "m" },
      ])
    );
    reconcileFresh({ confirmed: 2, errored: 0, aborted: false, retry: false });
    const task = makeTask({ target_count: 2, ipfs_definition_hash: "QmFrozen", replicas: 2 });

    const result = await runListTask(db, task, signal());

    expect(reserve).toHaveBeenCalledExactlyOnceWith(
      { market: "m", count: 2, idempotencyKey: `${task._id.toHexString()}:reserve:0` },
      expect.any(AbortSignal)
    );
    expect(tasksUpdateOne).toHaveBeenCalledExactlyOnceWith(
      { _id: task._id },
      {
        $set: {
          reservation: {
            key: `${task._id.toHexString()}:reserve:0`,
            epoch: 0,
            expiresAt: expect.any(Date),
            nodes: [
              { node: "n1", market: "m" },
              { node: "n2", market: "m" },
            ],
          },
        },
      }
    );
    expect(order).toEqual(["persist", "spawn"]); // reservation recorded before anything is signed
    expect(spawnedNodes()).toEqual([
      [
        { node: "n1", market: "m" },
        { node: "n2", market: "m" },
      ],
    ]);
    expect(eventTypes()).toEqual(["JOB_RESERVE_CONFIRMED"]);
    expect(result.outcome).toBe("COMPLETED");
  });

  it("reserves within the deployment's market, filtered by its requirements", async () => {
    reserve.mockResolvedValue(reserved([{ nodeAddress: "n1", market: "m" }]));
    reconcileFresh();
    const task = makeTask({ target_count: 1, ipfs_definition_hash: "Qm", replicas: 1, requirements: { gpu: "RTX 4090" } });

    await runListTask(db, task, signal());

    expect(reserve.mock.calls[0][0]).toEqual({
      market: "m",
      requirements: { gpu: "RTX 4090" },
      count: 1,
      idempotencyKey: `${task._id.toHexString()}:reserve:0`,
    });
    expect(spawnedNodes()).toEqual([[{ node: "n1", market: "m" }]]);
  });

  it("records each confirmed job's node and its own market from the reservation", async () => {
    reserve.mockResolvedValue(reserved([{ nodeAddress: "n1", market: "m" }]));
    reconcileUnits.mockImplementation(
      async ({ makeWorker, handlers }: {
        makeWorker: (count: number, startUnit: number) => unknown;
        handlers: {
          onConfirmed: (
            u: number,
            s: string,
            j?: string,
            r?: string,
            n?: { node: string; market: string }
          ) => unknown;
        };
      }) => {
        await makeWorker(1, 0);
        await handlers.onConfirmed(0, "sig-1", "job-1", "run-1", { node: "n1", market: "m" });
        return { confirmed: 1, errored: 0, aborted: false, retry: false };
      }
    );
    const task = makeTask({ target_count: 1, ipfs_definition_hash: "Qm", replicas: 1 });

    await runListTask(db, task, signal());

    expect(onListConfirmed).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      task,
      "sig-1",
      "job-1",
      { node: "n1", market: "m" }
    );
  });

  it("on reclaim within the hold, reuses the recorded nodes and skips the ones already assigned", async () => {
    reconcileFresh({ confirmed: 2, errored: 0, aborted: false, retry: false });
    const task = makeTask({
      target_count: 2,
      ipfs_definition_hash: "Qm",
      replicas: 2,
      reservation: {
        key: "k:reserve:0",
        epoch: 0,
        expiresAt: inAMinute(),
        nodes: [
          { node: "n1", market: "m" },
          { node: "n2", market: "m" },
        ],
      },
      transactions: [{ unit: 0, signature: "s", lastValidBlockHeight: 1, status: "SENT", jobs: ["j1"], nodes: ["n1"] }],
    });

    await runListTask(db, task, signal());

    expect(reserve).not.toHaveBeenCalled(); // same key, same hold: nothing new to ask for
    expect(tasksUpdateOne).not.toHaveBeenCalled();
    expect(spawnedNodes()).toEqual([[{ node: "n2", market: "m" }]]); // n1 was already assigned
  });

  it("after an assign error used every reserved node, reserves under a bumped epoch and never reassigns them", async () => {
    reserve.mockResolvedValue(
      reserved([
        { nodeAddress: "n1", market: "m" }, // released after a lapsed hold, handed out again
        { nodeAddress: "n3", market: "m" },
      ])
    );
    reconcileFresh();
    const task = makeTask({
      target_count: 2,
      ipfs_definition_hash: "Qm",
      replicas: 2,
      reservation: {
        key: "k:reserve:0",
        epoch: 0,
        expiresAt: inAMinute(),
        nodes: [
          { node: "n1", market: "m" },
          { node: "n2", market: "m" },
        ],
      },
      // The bucket that carried n1 + n2 failed on chain (program error).
      transactions: [{ unit: 0, signature: "s", lastValidBlockHeight: 1, status: "SENT", jobs: ["j1", "j2"], nodes: ["n1", "n2"] }],
    });

    await runListTask(db, task, signal());

    expect(reserve.mock.calls[0][0]).toMatchObject({ idempotencyKey: `${task._id.toHexString()}:reserve:1`, count: 2 });
    expect(tasksUpdateOne.mock.calls[0][1]).toMatchObject({ $set: { reservation: { epoch: 1 } } });
    expect(spawnedNodes()).toEqual([[{ node: "n3", market: "m" }]]);
  });

  it("a lapsed hold is not reused: the next epoch reserves afresh", async () => {
    reserve.mockResolvedValue(reserved([{ nodeAddress: "n1", market: "m" }]));
    reconcileFresh();
    const task = makeTask({
      target_count: 1,
      ipfs_definition_hash: "Qm",
      replicas: 1,
      reservation: { key: "k:reserve:4", epoch: 4, expiresAt: new Date(Date.now() - 1), nodes: [{ node: "n1", market: "m" }] },
    });

    await runListTask(db, task, signal());

    expect(reserve.mock.calls[0][0]).toMatchObject({ idempotencyKey: `${task._id.toHexString()}:reserve:5` });
  });

  it("no matching node: records the empty reservation, emits a shortfall and RETRYs with the cooldown", async () => {
    reserve.mockResolvedValue(reserved([], 3));
    reconcileFresh();
    const task = makeTask({ target_count: 3, ipfs_definition_hash: "Qm", replicas: 3 });

    const result = await runListTask(db, task, signal());

    expect(VaultWorker).not.toHaveBeenCalled();
    expect(tasksUpdateOne.mock.calls[0][1]).toMatchObject({ $set: { reservation: { epoch: 0, nodes: [], expiresAt: null } } });
    expect(eventTypes()).toEqual(["JOB_RESERVE_SHORTFALL"]);
    expect(eventsInsertOne.mock.calls[0][0]).toMatchObject({ message: "3 of 3 job(s) waiting for a matching node" });
    expect(result.outcome).toBe("RETRY");
    expect(result.retryAfterMs).toBeGreaterThanOrEqual(30_000); // escalating cooldown, not the in-flight poll
    expect(deploymentsUpdateOne).toHaveBeenCalledWith({ id: "dep-1" }, { $set: { next_retry_at: expect.any(Date) } });
    expect(onListExit).not.toHaveBeenCalled();
  });

  it("a partial reservation assigns what was reserved and RETRYs for the remainder", async () => {
    reserve.mockResolvedValue(reserved([{ nodeAddress: "n1", market: "m" }], 2));
    reconcileFresh({ confirmed: 1, errored: 0, aborted: false, retry: false });
    const task = makeTask({ target_count: 2, ipfs_definition_hash: "Qm", replicas: 2 });

    const result = await runListTask(db, task, signal());

    expect(spawnedNodes()).toEqual([[{ node: "n1", market: "m" }]]);
    expect(eventTypes()).toEqual(["JOB_RESERVE_CONFIRMED", "JOB_RESERVE_SHORTFALL"]);
    expect(result).toMatchObject({ outcome: "RETRY", successCount: 1 });
  });

  it("caps a request at host-manager's 50 and reconciles the rest next attempt", async () => {
    reserve.mockResolvedValue(reserved([], 50));
    reconcileFresh();
    const task = makeTask({ target_count: 80, ipfs_definition_hash: "Qm", replicas: 80 });

    await runListTask(db, task, signal());

    expect(reserve.mock.calls[0][0]).toMatchObject({ count: 50 });
  });

  it("422 (bad requirements) fails the task terminally and flags the deployment ERROR with the message", async () => {
    reserve.mockRejectedValue(new HostManagerError(422, "Unknown metric: gpu_colour"));
    reconcileFresh();
    const task = makeTask({ target_count: 1, ipfs_definition_hash: "Qm", replicas: 1, requirements: { gpu_colour: "red" } });

    const result = await runListTask(db, task, signal());

    expect(result.outcome).toBe("FAILED");
    expect(VaultWorker).not.toHaveBeenCalled();
    expect(tasksUpdateOne).not.toHaveBeenCalled(); // nothing reserved, nothing recorded
    expect(eventsInsertOne).toHaveBeenCalledWith(
      expect.objectContaining({ type: "JOB_LIST_ERROR", message: expect.stringContaining("Unknown metric: gpu_colour") })
    );
    expect(deploymentsUpdateOne).toHaveBeenCalledWith(
      { id: "dep-1", status: { $ne: "ARCHIVED" } },
      { $set: { status: "ERROR" } }
    );
  });

  it("409 (same key in flight) is an in-flight wait: short re-poll, nothing recorded", async () => {
    reserve.mockRejectedValue(new HostManagerError(409, "Reservation k is already in progress"));
    reconcileFresh();
    const task = makeTask({ target_count: 1, ipfs_definition_hash: "Qm", replicas: 1 });

    const result = await runListTask(db, task, signal());

    expect(result).toMatchObject({ outcome: "RETRY", retryAfterMs: 5_000 });
    expect(tasksUpdateOne).not.toHaveBeenCalled(); // no epoch bump: the next attempt reuses the key
    expect(onListError).not.toHaveBeenCalled();
  });

  it("503 / no response retries the same key after the cooldown", async () => {
    reserve.mockRejectedValue(new HostManagerError(503, "Failed to read on-chain markets"));
    reconcileFresh();
    const task = makeTask({ target_count: 1, ipfs_definition_hash: "Qm", replicas: 1 });

    const result = await runListTask(db, task, signal());

    expect(result.outcome).toBe("RETRY");
    expect(result.retryAfterMs).toBeGreaterThanOrEqual(30_000);
    expect(onListError.mock.calls[0][2]).toContain("Failed to read on-chain markets");
    expect(tasksUpdateOne).not.toHaveBeenCalled(); // nothing recorded → the next attempt re-sends reserve:0
  });
});

describe("runListTask API-key path", () => {
  beforeEach(() => {
    vaultKey.value = "nos_api_key";
  });

  it("reserves like self-custody, with the deployment's requirements, and hands the worker the whole hold and its epoch", async () => {
    reserve.mockResolvedValue(
      reserved([
        { nodeAddress: "n1", market: "m" },
        { nodeAddress: "n2", market: "m" },
      ])
    );
    reconcileFresh({ confirmed: 2, errored: 0, aborted: false, retry: false });
    const task = makeTask({ target_count: 2, ipfs_definition_hash: "Qm", replicas: 2, requirements: { gpu: "RTX 4090" } });

    const result = await runListTask(db, task, signal());

    expect(reserve).toHaveBeenCalledExactlyOnceWith(
      { market: "m", requirements: { gpu: "RTX 4090" }, count: 2, idempotencyKey: `${task._id.toHexString()}:reserve:0` },
      expect.any(AbortSignal)
    );
    expect(spawnedWorkerData()).toEqual([
      expect.objectContaining({
        nodes: [
          { node: "n1", market: "m" },
          { node: "n2", market: "m" },
        ],
        reservationEpoch: 0,
      }),
    ]);
    expect(result.outcome).toBe("COMPLETED");
  });

  it("on reclaim within the hold, hands the worker the whole hold again (same key, same payload), not just the unused nodes", async () => {
    // One unit already confirmed: reconcile tops up the one-job shortfall from unit 1.
    reconcileUnits.mockImplementation(async ({ makeWorker }: { makeWorker: (count: number, startUnit: number) => unknown }) => {
      await makeWorker(1, 1);
      return { confirmed: 2, errored: 0, aborted: false, retry: false };
    });
    const task = makeTask({
      target_count: 2,
      ipfs_definition_hash: "Qm",
      replicas: 2,
      reservation: {
        key: "k:reserve:1",
        epoch: 1,
        expiresAt: inAMinute(),
        nodes: [
          { node: "n1", market: "m" },
          { node: "n2", market: "m" },
        ],
      },
      transactions: [{ unit: 0, signature: "tx-1", lastValidBlockHeight: 0, status: "CONFIRMED", jobs: ["job-1"], nodes: ["n1"], markets: ["m"] }],
    });

    const result = await runListTask(db, task, signal());

    expect(reserve).not.toHaveBeenCalled();
    expect(spawnedWorkerData()).toEqual([
      expect.objectContaining({
        nodes: [
          { node: "n1", market: "m" },
          { node: "n2", market: "m" },
        ],
        reservationEpoch: 1,
      }),
    ]);
    expect(result.outcome).toBe("COMPLETED");
  });
});
