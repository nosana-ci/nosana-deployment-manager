import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  // Single stable object: the mocked worker_threads module hands this exact
  // reference to the worker, so tests mutate it in place between runs.
  workerData: {} as Record<string, unknown>,
  useNosanaApiKey: false,
  postMessage: vi.fn(),
  listMany: vi.fn(async () => []),
  signBatch: vi.fn(async () => []),
  listBatch: vi.fn(),
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
      jobs: { listMany: state.listMany, signBatch: state.signBatch },
      api: { jobs: { listBatch: state.listBatch } },
    },
  })),
  workerErrorFormatter: (error: unknown) => (error instanceof Error ? `${error.name} ${error.message}` : String(error)),
}));

async function runWorker(market: string, { useNosanaApiKey = false } = {}): Promise<void> {
  for (const key of Object.keys(state.workerData)) delete state.workerData[key];
  Object.assign(state.workerData, {
    task: { deployment: { market, timeout: 60 }, transactions: [] },
    taskId: "task-1",
    vault: "encrypted-vault-key",
    ipfs_definition_hash: "QmDefinition",
    count: 1,
    startUnit: 0,
    target: 1,
  });
  state.useNosanaApiKey = useNosanaApiKey;
  vi.resetModules();
  await import("./worker.js");
}

describe("LIST worker", () => {
  beforeEach(() => {
    state.postMessage.mockClear();
    state.listMany.mockClear();
    state.signBatch.mockClear();
    state.listBatch.mockClear();
  });

  it("lists on the deployment's market", async () => {
    const market = "DfJJiNU3siRQUz2a67tqoY72fUzwR8MhBEMBGK85SwAr";
    await runWorker(market);

    expect(state.listMany).toHaveBeenCalledWith(expect.objectContaining({ market }), 1);
    expect(state.postMessage).toHaveBeenLastCalledWith({ event: "DONE" });
  });
});
