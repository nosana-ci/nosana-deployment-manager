import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";

import { DeploymentStrategy } from "../../../types/index.js";
import type { OutstandingTasksDocument, TaskReservation, TaskReservationRequest, TxRecord } from "../../../types/index.js";

const order: string[] = [];
const reconcileUnits = vi.fn();
type Write = (...a: unknown[]) => Promise<{ acknowledged: boolean }>;
const tasksUpdateOne = vi.fn<Write>(async () => ({ acknowledged: true }));
const deploymentsUpdateOne = vi.fn<Write>(async () => ({ acknowledged: true }));
const eventsInsertOne = vi.fn<Write>(async () => ({ acknowledged: true }));
const onListExit = vi.fn(async () => {});
const onListConfirmed = vi.fn();
const requestReservation = vi.fn();
const scheduleTask = vi.fn();
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
  requestReservation: (...a: unknown[]) => {
    order.push("request");
    return requestReservation(...a);
  },
}));
vi.mock("../../scheduleTask.js", () => ({
  scheduleTask: (...a: unknown[]) => scheduleTask(...a),
}));
const checkTaskWanted = vi.fn(async () => true);
vi.mock("../../queue/wanted/index.js", () => ({
  checkTaskWanted: (...a: unknown[]) => checkTaskWanted(...a),
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
import { setConfig } from "../../../config/index.js";
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
  job?: string;
  active_revision?: number;
  reservation?: TaskReservation;
  reservation_request?: TaskReservationRequest;
  transactions?: TxRecord[];
  assign_posted_at?: Date;
}): OutstandingTasksDocument {
  return {
    _id: new ObjectId(),
    deploymentId: "dep-1",
    target_count: over.target_count,
    ipfs_definition_hash: over.ipfs_definition_hash,
    reservation: over.reservation,
    reservation_request: over.reservation_request,
    job: over.job,
    active_revision: over.active_revision,
    assign_posted_at: over.assign_posted_at,
    transactions: over.transactions ?? [],
    jobs: over.jobs ?? [],
    deployment: {
      replicas: over.replicas,
      strategy: over.strategy ?? "SIMPLE",
      vault: { vault_key: "k" },
      active_revision: 1,
      market: over.market ?? "m",
      requirements: over.requirements ?? null,
      status: "RUNNING",
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

type Node = { nodeAddress: string; market: string };

function fulfilled(nodes: Node[], requested = nodes.length) {
  return {
    key: "k",
    status: "fulfilled",
    requested,
    nodes,
    holdExpiresAt: inAMinute().toISOString(),
    expiresAt: inAMinute().toISOString(),
  };
}

function answered(status: "waiting" | "expired" | "cancelled", requested = 1) {
  return { key: "k", status, requested, nodes: [], holdExpiresAt: null, expiresAt: inAMinute().toISOString() };
}

/** A request host-manager already answered `waiting`: only a marker is stored, never its terms. */
const pendingRequest = (): TaskReservationRequest => ({ since: new Date(Date.now() - 60_000) });

/** The options of the hand-off LIST task the run scheduled, if any. */
const handOff = () => scheduleTask.mock.calls.map(([, type, deploymentId, , due, options]) => ({ type, deploymentId, due, options }));

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
  requestReservation.mockReset();
  scheduleTask.mockReset().mockResolvedValue(true);
  vi.mocked(VaultWorker).mockClear();
  resolveListDefinitionHash.mockReset().mockReturnValue("QmDefinition");
  checkTaskWanted.mockReset().mockResolvedValue(true);
  vaultKey.value = "solana-secret-key";
});

describe("runListTask target", () => {
  it("hands the frozen definition hash to the signer worker", async () => {
    requestReservation.mockResolvedValue(fulfilled([{ nodeAddress: "n1", market: "m" }]));
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

  it.each([
    [DeploymentStrategy.SIMPLE, 2],
    [DeploymentStrategy["SIMPLE-EXTEND"], 2],
    [DeploymentStrategy.INFINITE, 2],
    // Each cron firing posts a full set.
    [DeploymentStrategy.SCHEDULED, 3],
  ])("%s: brings the task's own revision up to replicas, whatever other revisions still run", async (strategy, target) => {
    // A swap to revision 2: two revision-1 jobs are being retired, one revision-2 job is up.
    const jobs = [{ revision: 1 }, { revision: 1 }, { revision: 2 }];
    const task = makeTask({ replicas: 3, strategy, jobs, active_revision: 2 });

    await runListTask(db, task, signal());

    expect(reconcileUnits).toHaveBeenCalledWith(expect.objectContaining({ target }));
  });

  it("an explicit limit is the target as given", async () => {
    const task = makeTask({ replicas: 3, jobs: [{ revision: 1 }], active_revision: 1 });
    task.limit = 1;

    await runListTask(db, task, signal());

    expect(reconcileUnits).toHaveBeenCalledWith(expect.objectContaining({ target: 1 }));
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
  it("records the request (keyed by the task id) before sending it, and the fill before the worker signs", async () => {
    requestReservation.mockResolvedValue(
      fulfilled([
        { nodeAddress: "n1", market: "m" },
        { nodeAddress: "n2", market: "m" },
      ])
    );
    reconcileFresh({ confirmed: 2, errored: 0, aborted: false, retry: false });
    const task = makeTask({ target_count: 2, ipfs_definition_hash: "QmFrozen", replicas: 2 });

    const result = await runListTask(db, task, signal());

    expect(requestReservation).toHaveBeenCalledExactlyOnceWith(
      { key: task._id.toHexString(), market: "m", count: 2, ttlSeconds: 900 },
      expect.any(AbortSignal)
    );
    expect(tasksUpdateOne.mock.calls).toEqual([
      // A marker only: the terms are sent, never stored.
      [{ _id: task._id }, { $set: { reservation_request: {} } }],
      [
        { _id: task._id },
        {
          $set: {
            reservation: {
              expiresAt: expect.any(Date),
              nodes: [
                { node: "n1", market: "m" },
                { node: "n2", market: "m" },
              ],
            },
          },
          $unset: { reservation_request: "" },
        },
      ],
    ]);
    // The request is on the task before host-manager sees it, the nodes before anything is signed.
    expect(order).toEqual(["persist", "request", "persist", "spawn"]);
    expect(spawnedNodes()).toEqual([
      [
        { node: "n1", market: "m" },
        { node: "n2", market: "m" },
      ],
    ]);
    expect(eventTypes()).toEqual(["JOB_RESERVE_CONFIRMED"]);
    expect(scheduleTask).not.toHaveBeenCalled();
    expect(result.outcome).toBe("COMPLETED");
  });

  it("requests within the deployment's market, filtered by its requirements", async () => {
    requestReservation.mockResolvedValue(fulfilled([{ nodeAddress: "n1", market: "m" }]));
    reconcileFresh({ confirmed: 1, errored: 0, aborted: false, retry: false });
    const task = makeTask({ target_count: 1, ipfs_definition_hash: "Qm", replicas: 1, requirements: { gpu: "RTX 4090" } });

    await runListTask(db, task, signal());

    expect(requestReservation.mock.calls[0][0]).toEqual({
      key: task._id.toHexString(),
      market: "m",
      requirements: { gpu: "RTX 4090" },
      count: 1,
      ttlSeconds: 900, // one minute past the 14-minute renewal, at host-manager's cap
    });
  });

  it("records each confirmed job's node and its own market from the reservation", async () => {
    requestReservation.mockResolvedValue(fulfilled([{ nodeAddress: "n1", market: "m" }]));
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

  it("on reclaim within the hold (or after the webhook), reuses the recorded nodes and skips the ones already assigned", async () => {
    reconcileFresh({ confirmed: 2, errored: 0, aborted: false, retry: false });
    const task = makeTask({
      target_count: 2,
      ipfs_definition_hash: "Qm",
      replicas: 2,
      reservation: {
        expiresAt: inAMinute(),
        nodes: [
          { node: "n1", market: "m" },
          { node: "n2", market: "m" },
        ],
      },
      transactions: [{ unit: 0, signature: "s", lastValidBlockHeight: 1, status: "SENT", jobs: ["j1"], nodes: ["n1"] }],
    });

    await runListTask(db, task, signal());

    expect(requestReservation).not.toHaveBeenCalled(); // the task's one request is already filled
    expect(tasksUpdateOne).not.toHaveBeenCalled();
    expect(spawnedNodes()).toEqual([[{ node: "n2", market: "m" }]]); // n1 was already assigned
  });

  it("does not reuse a live hold in a market the deployment has left: it hands off at once", async () => {
    reconcileFresh();
    const task = makeTask({
      target_count: 1,
      ipfs_definition_hash: "Qm",
      replicas: 1,
      market: "m2",
      reservation: { expiresAt: inAMinute(), nodes: [{ node: "n1", market: "m" }] },
    });

    const result = await runListTask(db, task, signal());

    expect(VaultWorker).not.toHaveBeenCalled();
    expect(requestReservation).not.toHaveBeenCalled();
    expect(handOff()).toEqual([
      { type: "LIST", deploymentId: "dep-1", due: expect.any(Date), options: expect.objectContaining({ limit: 1 }) },
    ]);
    expect(handOff()[0].due.getTime()).toBeLessThanOrEqual(Date.now()); // no backoff: the deployment moved on
    expect(result.outcome).toBe("COMPLETED");
  });

  it("a fill that is spent (every node used after an assign error) hands off after the cooldown", async () => {
    reconcileFresh();
    const task = makeTask({
      target_count: 2,
      ipfs_definition_hash: "Qm",
      replicas: 2,
      reservation: {
        expiresAt: inAMinute(),
        nodes: [
          { node: "n1", market: "m" },
          { node: "n2", market: "m" },
        ],
      },
      // The bucket that carried n1 + n2 failed on chain (program error).
      transactions: [{ unit: 0, signature: "s", lastValidBlockHeight: 1, status: "SENT", jobs: ["j1", "j2"], nodes: ["n1", "n2"] }],
    });

    const result = await runListTask(db, task, signal());

    expect(requestReservation).not.toHaveBeenCalled(); // never a second request for this task
    expect(VaultWorker).not.toHaveBeenCalled();
    expect(handOff()[0].options).toMatchObject({ limit: 2, handoff_of: task._id });
    expect(handOff()[0].due.getTime()).toBeGreaterThanOrEqual(Date.now() + 29_000);
    expect(result.outcome).toBe("COMPLETED");
  });

  it("a lapsed hold is never assigned: the task hands off", async () => {
    reconcileFresh();
    const task = makeTask({
      target_count: 1,
      ipfs_definition_hash: "Qm",
      replicas: 1,
      reservation: { expiresAt: new Date(Date.now() - 1), nodes: [{ node: "n1", market: "m" }] },
    });

    await runListTask(db, task, signal());

    expect(VaultWorker).not.toHaveBeenCalled();
    expect(handOff()).toHaveLength(1);
  });

  it("no capacity yet: parks until renewal, says so once, and is not an error", async () => {
    requestReservation.mockResolvedValue(answered("waiting", 3));
    reconcileFresh();
    const task = makeTask({ target_count: 3, ipfs_definition_hash: "Qm", replicas: 3 });

    const result = await runListTask(db, task, signal());

    expect(result).toEqual({ outcome: "PARKED", successCount: 0 }); // the consumer parks it for reservation_renew_ms
    expect(VaultWorker).not.toHaveBeenCalled();
    expect(tasksUpdateOne).toHaveBeenLastCalledWith(
      { _id: task._id, reservation_request: { $exists: true } },
      { $set: { "reservation_request.since": expect.any(Date) } }
    );
    expect(eventTypes()).toEqual(["JOB_RESERVE_WAITING"]);
    expect(eventsInsertOne.mock.calls[0][0]).toMatchObject({ message: "Waiting for 3 matching node(s) in market m" });
    // None of the error path: no JOB_LIST_ERROR, no retry stamp or ERROR on the deployment, no hand-off.
    expect(onListError).not.toHaveBeenCalled();
    expect(deploymentsUpdateOne).not.toHaveBeenCalled();
    expect(scheduleTask).not.toHaveBeenCalled();
    expect(onListExit).not.toHaveBeenCalled();
  });

  it("renews a parked request under the same key, and stays quiet while it keeps waiting", async () => {
    requestReservation.mockResolvedValue(answered("waiting"));
    reconcileFresh();
    const task = makeTask({ target_count: 1, ipfs_definition_hash: "Qm", replicas: 1, reservation_request: pendingRequest() });

    const result = await runListTask(db, task, signal());

    expect(requestReservation).toHaveBeenCalledExactlyOnceWith(
      { key: task._id.toHexString(), market: "m", count: 1, ttlSeconds: 900 },
      expect.any(AbortSignal)
    );
    expect(result.outcome).toBe("PARKED");
    expect(tasksUpdateOne).not.toHaveBeenCalled(); // same request, already noted as waiting
    expect(eventsInsertOne).not.toHaveBeenCalled(); // JOB_RESERVE_WAITING is once per request
  });

  it("a renewal that comes back fulfilled (missed webhook) records the nodes and assigns them", async () => {
    requestReservation.mockResolvedValue(fulfilled([{ nodeAddress: "n1", market: "m" }]));
    reconcileFresh({ confirmed: 1, errored: 0, aborted: false, retry: false });
    const task = makeTask({ target_count: 1, ipfs_definition_hash: "Qm", replicas: 1, reservation_request: pendingRequest() });

    const result = await runListTask(db, task, signal());

    expect(requestReservation).toHaveBeenCalledTimes(1);
    expect(spawnedNodes()).toEqual([[{ node: "n1", market: "m" }]]);
    expect(result.outcome).toBe("COMPLETED");
  });

  it.each([
    ["expired", answered("expired")],
    ["cancelled", answered("cancelled")],
    ["a replayed fill whose hold lapsed", { ...fulfilled([{ nodeAddress: "n1", market: "m" }]), holdExpiresAt: new Date(Date.now() - 1).toISOString() }],
  ])("a renewal answered %s hands what is missing to a new LIST task after the cooldown", async (_case, response) => {
    requestReservation.mockResolvedValue(response);
    reconcileFresh();
    const task = makeTask({ target_count: 1, ipfs_definition_hash: "Qm", replicas: 1, reservation_request: pendingRequest() });

    const result = await runListTask(db, task, signal());

    expect(requestReservation).toHaveBeenCalledTimes(1); // no second request from this task
    expect(VaultWorker).not.toHaveBeenCalled();
    expect(handOff()).toEqual([
      {
        type: "LIST",
        deploymentId: "dep-1",
        due: expect.any(Date),
        options: { limit: 1, job: undefined, active_revision: undefined, handoff_of: task._id },
      },
    ]);
    // Backed off: a chain of lapsed or expired requests cannot spin.
    expect(handOff()[0].due.getTime()).toBeGreaterThanOrEqual(Date.now() + 29_000);
    expect(eventTypes()).toEqual(["JOB_RESERVE_SHORTFALL"]);
    expect(onListError).not.toHaveBeenCalled();
    expect(result.outcome).toBe("COMPLETED");
  });

  it("a renewal after the deployment's terms changed sends the new terms; host-manager's 409 hands off at once", async () => {
    requestReservation.mockRejectedValue(new HostManagerError(409, "Request key reused with different terms"));
    reconcileFresh();
    const task = makeTask({
      target_count: 1,
      ipfs_definition_hash: "Qm",
      replicas: 1,
      market: "m2",
      requirements: { gpu: "H100" },
      reservation_request: pendingRequest(),
    });

    const result = await runListTask(db, task, signal());

    expect(requestReservation).toHaveBeenCalledExactlyOnceWith(
      { key: task._id.toHexString(), market: "m2", requirements: { gpu: "H100" }, count: 1, ttlSeconds: 900 },
      expect.any(AbortSignal)
    );
    expect(onListError).not.toHaveBeenCalled(); // not an error: the deployment moved on
    expect(deploymentsUpdateOne).not.toHaveBeenCalled();
    expect(handOff()[0].options).toMatchObject({ limit: 1, handoff_of: task._id });
    expect(handOff()[0].due.getTime()).toBeLessThanOrEqual(Date.now());
    expect(result.outcome).toBe("COMPLETED");
  });

  it("a partial fill assigns what came back and hands the remainder to a new LIST task straight away", async () => {
    requestReservation.mockResolvedValue(fulfilled([{ nodeAddress: "n1", market: "m" }], 3));
    reconcileFresh({ confirmed: 1, errored: 0, aborted: false, retry: false });
    const task = makeTask({ target_count: 3, ipfs_definition_hash: "Qm", replicas: 3 });

    const result = await runListTask(db, task, signal());

    expect(requestReservation).toHaveBeenCalledTimes(1);
    expect(spawnedNodes()).toEqual([[{ node: "n1", market: "m" }]]);
    expect(handOff()[0].options).toMatchObject({ limit: 2, handoff_of: task._id });
    expect(handOff()[0].due.getTime()).toBeLessThanOrEqual(Date.now()); // no cooldown: this round made progress
    expect(eventTypes()).toEqual(["JOB_RESERVE_CONFIRMED", "JOB_RESERVE_SHORTFALL"]);
    expect(eventsInsertOne.mock.calls[1][0]).toMatchObject({ message: "2 job(s) still need a node: requested again by a new LIST task" });
    expect(onListError).not.toHaveBeenCalled();
    expect(deploymentsUpdateOne).not.toHaveBeenCalled();
    expect(onListExit).toHaveBeenCalledWith(task);
    expect(result).toEqual({ outcome: "COMPLETED", successCount: 1 });
  });

  it("a hand-off carries the rotated job and the revision of an INFINITE rotation LIST", async () => {
    requestReservation.mockResolvedValue(answered("expired"));
    reconcileFresh();
    const task = makeTask({
      target_count: 1,
      ipfs_definition_hash: "Qm",
      replicas: 2,
      strategy: DeploymentStrategy.INFINITE,
      job: "rotated-job",
      active_revision: 4,
      reservation_request: pendingRequest(),
    });

    await runListTask(db, task, signal());

    expect(handOff()[0].options).toEqual({
      limit: 1,
      job: "rotated-job",
      active_revision: 4,
      handoff_of: task._id,
    });
  });

  it("a reclaimed task that already handed off does not announce it twice", async () => {
    scheduleTask.mockResolvedValue(false); // the idempotent hand-off already exists
    requestReservation.mockResolvedValue(answered("expired"));
    reconcileFresh();
    const task = makeTask({ target_count: 1, ipfs_definition_hash: "Qm", replicas: 1, reservation_request: pendingRequest() });

    await runListTask(db, task, signal());

    expect(eventsInsertOne).not.toHaveBeenCalled();
  });

  it("does not hand off after an assign error: the error path retries with the cooldown", async () => {
    requestReservation.mockResolvedValue(fulfilled([{ nodeAddress: "n1", market: "m" }], 2));
    reconcileUnits.mockImplementation(async ({ makeWorker, handlers }: {
      makeWorker: (count: number, startUnit: number) => unknown;
      handlers: { onError: (u: number, e: string) => void };
    }) => {
      await makeWorker(2, 0);
      await handlers.onError(0, "Transaction simulation failed");
      return { confirmed: 0, errored: 1, aborted: false, retry: false };
    });
    const task = makeTask({ target_count: 2, ipfs_definition_hash: "Qm", replicas: 2 });

    const result = await runListTask(db, task, signal());

    expect(scheduleTask).not.toHaveBeenCalled();
    expect(result.outcome).toBe("RETRY");
    expect(result.retryAfterMs).toBeGreaterThanOrEqual(30_000);
  });

  it("a fill with no node (never expected) hands off after the cooldown instead of looping", async () => {
    requestReservation.mockResolvedValue(fulfilled([], 2));
    reconcileFresh();
    const task = makeTask({ target_count: 2, ipfs_definition_hash: "Qm", replicas: 2 });

    const result = await runListTask(db, task, signal());

    expect(VaultWorker).not.toHaveBeenCalled();
    expect(handOff()[0].due.getTime()).toBeGreaterThanOrEqual(Date.now() + 29_000);
    expect(result.outcome).toBe("COMPLETED");
  });

  it("caps a request at host-manager's 50; the rest goes to a hand-off", async () => {
    requestReservation.mockResolvedValue(answered("waiting", 50));
    reconcileFresh();
    const task = makeTask({ target_count: 80, ipfs_definition_hash: "Qm", replicas: 80 });

    await runListTask(db, task, signal());

    expect(requestReservation.mock.calls[0][0]).toMatchObject({ count: 50 });
  });

  it("422 (bad requirements) fails the task terminally and flags the deployment ERROR with the message", async () => {
    requestReservation.mockRejectedValue(new HostManagerError(422, "Unknown metric: gpu_colour"));
    reconcileFresh();
    const task = makeTask({ target_count: 1, ipfs_definition_hash: "Qm", replicas: 1, requirements: { gpu_colour: "red" } });

    const result = await runListTask(db, task, signal());

    expect(result.outcome).toBe("FAILED");
    expect(VaultWorker).not.toHaveBeenCalled();
    expect(eventsInsertOne).toHaveBeenCalledWith(
      expect.objectContaining({ type: "JOB_LIST_ERROR", message: expect.stringContaining("Unknown metric: gpu_colour") })
    );
    expect(deploymentsUpdateOne).toHaveBeenCalledWith(
      { id: "dep-1", status: { $ne: "ARCHIVED" } },
      { $set: { status: "ERROR" } }
    );
  });

  it("asks for a TTL a minute past the renewal interval, so a parked request never lapses between renewals", async () => {
    setConfig("reservation_renew_ms", 60_000);
    requestReservation.mockResolvedValue(answered("waiting"));
    reconcileFresh();
    const task = makeTask({ target_count: 1, ipfs_definition_hash: "Qm", replicas: 1 });

    await runListTask(db, task, signal());

    expect(requestReservation.mock.calls[0][0]).toMatchObject({ ttlSeconds: 120 });
    setConfig("reservation_renew_ms", 14 * 60_000);
  });

  it("404 (unknown market) is fatal like any other 4xx", async () => {
    requestReservation.mockRejectedValue(new HostManagerError(404, "Unknown market"));
    reconcileFresh();
    const task = makeTask({ target_count: 1, ipfs_definition_hash: "Qm", replicas: 1 });

    const result = await runListTask(db, task, signal());

    expect(result.outcome).toBe("FAILED");
  });

  it("503 / no response retries after the cooldown, keeping the request so the same key is re-sent", async () => {
    requestReservation.mockRejectedValue(new HostManagerError(503, "Failed to read on-chain markets"));
    reconcileFresh();
    const task = makeTask({ target_count: 1, ipfs_definition_hash: "Qm", replicas: 1 });

    const result = await runListTask(db, task, signal());

    expect(result.outcome).toBe("RETRY");
    expect(result.retryAfterMs).toBeGreaterThanOrEqual(30_000);
    expect(onListError.mock.calls[0][2]).toContain("Failed to read on-chain markets");
    expect(tasksUpdateOne).toHaveBeenCalledExactlyOnceWith(
      { _id: task._id },
      { $set: { reservation_request: {} } }
    );
    expect(scheduleTask).not.toHaveBeenCalled();
  });
});

describe("runListTask once no longer wanted (drain)", () => {
  it("is judged again before reserving, and then requests, signs and hands off nothing", async () => {
    checkTaskWanted.mockResolvedValue(false);
    reconcileFresh({ confirmed: 0, errored: 0, aborted: false, retry: false });
    const task = makeTask({ target_count: 2, ipfs_definition_hash: "Qm", replicas: 2, reservation_request: pendingRequest() });

    const result = await runListTask(db, task, signal());

    expect(checkTaskWanted).toHaveBeenCalledWith(task);
    expect(requestReservation).not.toHaveBeenCalled();
    expect(VaultWorker).not.toHaveBeenCalled();
    expect(scheduleTask).not.toHaveBeenCalled();
    expect(onListExit).not.toHaveBeenCalled(); // no next cron firing either
    expect(result).toEqual({ outcome: "COMPLETED", successCount: 0 });
  });

  it("keeps what its resumed transactions confirmed and completes", async () => {
    checkTaskWanted.mockResolvedValue(false);
    reconcileUnits.mockImplementation(async ({ makeWorker }: { makeWorker: (count: number, startUnit: number) => unknown }) => {
      await makeWorker(1, 2); // two units resumed and confirmed, one short
      return { confirmed: 2, errored: 0, aborted: false, retry: false };
    });
    const task = makeTask({ target_count: 3, ipfs_definition_hash: "Qm", replicas: 3 });

    const result = await runListTask(db, task, signal());

    expect(VaultWorker).not.toHaveBeenCalled();
    expect(scheduleTask).not.toHaveBeenCalled(); // the shortfall is not handed off
    expect(result).toEqual({ outcome: "COMPLETED", successCount: 2 });
  });

  it("does not retry a handled error while draining", async () => {
    checkTaskWanted.mockResolvedValue(false);
    reconcileUnits.mockImplementation(
      async ({ makeWorker, handlers }: { makeWorker: (c: number, s: number) => unknown; handlers: { onError: (u: number, e: string) => void } }) => {
        await handlers.onError(0, "Transaction simulation failed");
        await makeWorker(1, 1);
        return { confirmed: 0, errored: 1, aborted: false, retry: false };
      }
    );
    const task = makeTask({ target_count: 1, ipfs_definition_hash: "Qm", replicas: 1 });

    const result = await runListTask(db, task, signal());

    expect(result.outcome).toBe("COMPLETED");
    expect(deploymentsUpdateOne).not.toHaveBeenCalled(); // no retry state stamped
  });

  describe("API-key path", () => {
    beforeEach(() => {
      vaultKey.value = "nos_api_key";
    });

    const posted = () =>
      makeTask({
        target_count: 2,
        ipfs_definition_hash: "Qm",
        replicas: 2,
        assign_posted_at: new Date(),
        reservation: {
          expiresAt: new Date(Date.now() - 1000), // a lapsed hold is re-sent all the same
          nodes: [
            { node: "n1", market: "m" },
            { node: "n2", market: "m" },
          ],
        },
      });

    it("re-sends the batch it posted, whole and under the same key, to record what landed", async () => {
      checkTaskWanted.mockResolvedValue(false);
      reconcileFresh({ confirmed: 2, errored: 0, aborted: false, retry: false });

      const result = await runListTask(db, posted(), signal());

      expect(requestReservation).not.toHaveBeenCalled();
      expect(spawnedNodes()).toEqual([
        [
          { node: "n1", market: "m" },
          { node: "n2", market: "m" },
        ],
      ]);
      expect(result).toEqual({ outcome: "COMPLETED", successCount: 2 });
    });

    it("comes back while the batch is still confirming", async () => {
      checkTaskWanted.mockResolvedValue(false);
      reconcileFresh({ confirmed: 0, errored: 0, aborted: false, retry: true, retryAfterMs: 3000 });

      const result = await runListTask(db, posted(), signal());

      expect(result).toEqual({ outcome: "RETRY", successCount: 0, retryAfterMs: 3000 });
    });

    it("sends nothing when it never posted a batch", async () => {
      checkTaskWanted.mockResolvedValue(false);
      reconcileFresh();
      const task = makeTask({
        target_count: 1,
        ipfs_definition_hash: "Qm",
        replicas: 1,
        reservation: { expiresAt: inAMinute(), nodes: [{ node: "n1", market: "m" }] }, // filled by the webhook, never posted
      });

      await runListTask(db, task, signal());

      expect(VaultWorker).not.toHaveBeenCalled();
    });
  });
});

describe("runListTask API-key path", () => {
  beforeEach(() => {
    vaultKey.value = "nos_api_key";
  });

  it("requests like self-custody, with the deployment's requirements, and hands the worker the whole hold", async () => {
    requestReservation.mockResolvedValue(
      fulfilled([
        { nodeAddress: "n1", market: "m" },
        { nodeAddress: "n2", market: "m" },
      ])
    );
    reconcileFresh({ confirmed: 2, errored: 0, aborted: false, retry: false });
    const task = makeTask({ target_count: 2, ipfs_definition_hash: "Qm", replicas: 2, requirements: { gpu: "RTX 4090" } });

    const result = await runListTask(db, task, signal());

    expect(requestReservation).toHaveBeenCalledExactlyOnceWith(
      { key: task._id.toHexString(), market: "m", requirements: { gpu: "RTX 4090" }, count: 2, ttlSeconds: 900 },
      expect.any(AbortSignal)
    );
    // From the post on, its jobs can land unseen: marked before the worker is spawned.
    expect(tasksUpdateOne).toHaveBeenLastCalledWith({ _id: task._id }, { $set: { assign_posted_at: expect.any(Date) } });
    expect(order.slice(-2)).toEqual(["persist", "spawn"]);
    expect(spawnedNodes()).toEqual([
      [
        { node: "n1", market: "m" },
        { node: "n2", market: "m" },
      ],
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
        expiresAt: inAMinute(),
        nodes: [
          { node: "n1", market: "m" },
          { node: "n2", market: "m" },
        ],
      },
      transactions: [{ unit: 0, signature: "tx-1", lastValidBlockHeight: 0, status: "CONFIRMED", jobs: ["job-1"], nodes: ["n1"], markets: ["m"] }],
    });

    const result = await runListTask(db, task, signal());

    expect(requestReservation).not.toHaveBeenCalled();
    expect(spawnedNodes()).toEqual([
      [
        { node: "n1", market: "m" },
        { node: "n2", market: "m" },
      ],
    ]);
    expect(result.outcome).toBe("COMPLETED");
  });
});
