import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  // Single stable object: the mocked worker_threads module hands this exact
  // reference to the worker, so tests mutate it in place between runs.
  workerData: {} as Record<string, unknown>,
  useNosanaApiKey: false,
  postMessage: vi.fn(),
  assignMany: vi.fn(async (params: unknown[]) => params.map((_, i) => ({ ix: i }))),
  signBatch: vi.fn(async (): Promise<unknown[]> => []),
  assignBatch: vi.fn(),
}));

vi.mock("worker_threads", () => ({
  workerData: state.workerData,
  parentPort: { postMessage: state.postMessage },
}));

vi.mock("../../../worker/Worker.js", () => ({
  prepareWorker: vi.fn(async (data: Record<string, unknown>) => ({
    ...data,
    useNosanaApiKey: state.useNosanaApiKey,
    kit: {
      jobs: { assignMany: state.assignMany, signBatch: state.signBatch },
      api: { jobs: { assignBatch: state.assignBatch } },
    },
  })),
  workerErrorFormatter: (error: unknown) => (error instanceof Error ? `${error.name} ${error.message}` : String(error)),
}));

const MARKET_A = "DfJJiNU3siRQUz2a67tqoY72fUzwR8MhBEMBGK85SwAr";
const MARKET_B = "7AtiXMSH6R1jjBxrcYjehCkkSF7zvYWte63gwEDBcGHq";
const NODE_1 = "9DcLW6JkuanvWP2CbKsohChFWGCEiTnAGxA4xdAYHVNq";
const NODE_2 = "4h6c5JG6fNQ5RvNGTBVdBDnTH8VcUj6WjkYZbAs1WSRk";

async function runWorker(
  market: string,
  {
    useNosanaApiKey = false,
    nodes = [] as { node: string; market: string }[],
    reservationEpoch = undefined as number | undefined,
    transactions = [] as unknown[],
  } = {}
): Promise<void> {
  for (const key of Object.keys(state.workerData)) delete state.workerData[key];
  Object.assign(state.workerData, {
    task: { deployment: { market, timeout: 60 }, transactions },
    taskId: "task-1",
    vault: "encrypted-vault-key",
    ipfs_definition_hash: "QmDefinition",
    count: nodes.length,
    startUnit: 3,
    nodes,
    reservationEpoch,
  });
  state.useNosanaApiKey = useNosanaApiKey;
  vi.resetModules();
  await import("./worker.js");
}

describe("LIST worker", () => {
  beforeEach(() => {
    state.postMessage.mockClear();
    state.assignMany.mockClear();
    state.signBatch.mockReset().mockResolvedValue([]);
    state.assignBatch.mockReset();
  });

  it("assigns one job per reserved node, each in that node's own market", async () => {
    await runWorker(MARKET_A, {
      nodes: [
        { node: NODE_1, market: MARKET_A },
        { node: NODE_2, market: MARKET_B },
      ],
    });

    expect(state.assignMany).toHaveBeenCalledExactlyOnceWith([
      { market: MARKET_A, timeout: 3600, ipfsHash: "QmDefinition", node: NODE_1 },
      { market: MARKET_B, timeout: 3600, ipfsHash: "QmDefinition", node: NODE_2 },
    ]);
    expect(state.signBatch).toHaveBeenCalledWith([{ ix: 0 }, { ix: 1 }], { computeUnitMargin: 3 });
    expect(state.postMessage).toHaveBeenLastCalledWith({ event: "DONE" });
  });

  it("emits one SIGNED per packed bucket carrying its jobs, runs and nodes", async () => {
    state.signBatch.mockResolvedValue([
      {
        blob: "blob-0",
        lastValidBlockHeight: 100n,
        signature: "sig-0",
        accounts: { jobs: ["job-1"], runs: ["run-1"], nodes: [NODE_1] },
      },
      {
        blob: "blob-1",
        lastValidBlockHeight: 101n,
        signature: "sig-1",
        accounts: { jobs: ["job-2"], runs: ["run-2"], nodes: [NODE_2] },
      },
    ]);

    await runWorker(MARKET_A, {
      nodes: [
        { node: NODE_1, market: MARKET_A },
        { node: NODE_2, market: MARKET_A },
      ],
    });

    const messages = state.postMessage.mock.calls.map(([message]) => message);
    expect(messages).toEqual([
      {
        event: "SIGNED",
        unit: 3,
        blob: "blob-0",
        lastValidBlockHeight: 100,
        signature: "sig-0",
        jobs: ["job-1"],
        runs: ["run-1"],
        nodes: [NODE_1],
        markets: [MARKET_A],
      },
      {
        event: "SIGNED",
        unit: 4,
        blob: "blob-1",
        lastValidBlockHeight: 101,
        signature: "sig-1",
        jobs: ["job-2"],
        runs: ["run-2"],
        nodes: [NODE_2],
        markets: [MARKET_A],
      },
      { event: "DONE" },
    ]);
  });

  it("API-key path has client-manager assign the whole hold under a reservation-scoped key", async () => {
    state.assignBatch.mockResolvedValue({
      items: [
        { index: 0, status: "confirmed", tx: "tx-1", job: "job-1", run: "run-1" },
        { index: 1, status: "confirmed", tx: "tx-1", job: "job-2", run: "run-2" },
      ],
    });

    await runWorker(MARKET_A, {
      useNosanaApiKey: true,
      reservationEpoch: 2,
      nodes: [
        { node: NODE_1, market: MARKET_A },
        { node: NODE_2, market: MARKET_B },
      ],
    });

    expect(state.assignBatch).toHaveBeenCalledExactlyOnceWith(
      {
        jobs: [
          { ipfsHash: "QmDefinition", market: MARKET_A, timeout: 3600, node: NODE_1 },
          { ipfsHash: "QmDefinition", market: MARKET_B, timeout: 3600, node: NODE_2 },
        ],
      },
      { idempotencyKey: "task-1:assign-2:0" }
    );
    expect(state.assignMany).not.toHaveBeenCalled();
    expect(state.postMessage.mock.calls.map(([message]) => message)).toEqual([
      { event: "CONFIRMED", unit: 3, job: "job-1", run: "run-1", tx: "tx-1", node: NODE_1, market: MARKET_A },
      { event: "CONFIRMED", unit: 4, job: "job-2", run: "run-2", tx: "tx-1", node: NODE_2, market: MARKET_B },
      { event: "DONE" },
    ]);
  });

  it("API-key path re-sends the whole hold on reclaim but emits CONFIRMED only for nodes not yet recorded", async () => {
    state.assignBatch.mockResolvedValue({
      items: [
        { index: 0, status: "confirmed", tx: "tx-1", job: "job-1", run: "run-1" },
        { index: 1, status: "confirmed", tx: "tx-1", job: "job-2", run: "run-2" },
      ],
    });

    await runWorker(MARKET_A, {
      useNosanaApiKey: true,
      reservationEpoch: 0,
      nodes: [
        { node: NODE_1, market: MARKET_A },
        { node: NODE_2, market: MARKET_A },
      ],
      transactions: [{ unit: 0, status: "CONFIRMED", signature: "tx-1", jobs: ["job-1"], nodes: [NODE_1] }],
    });

    expect(state.assignBatch.mock.calls[0][0].jobs.map((job: { node: string }) => job.node)).toEqual([NODE_1, NODE_2]);
    expect(state.postMessage.mock.calls.map(([message]) => message)).toEqual([
      { event: "CONFIRMED", unit: 3, job: "job-2", run: "run-2", tx: "tx-1", node: NODE_2, market: MARKET_A },
      { event: "DONE" },
    ]);
  });
});
