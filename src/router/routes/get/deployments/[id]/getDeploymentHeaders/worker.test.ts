import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  // Single stable object: the mocked worker_threads module hands this exact
  // reference to the worker, so tests mutate it in place between runs.
  workerData: {} as { includeTime?: boolean; message?: string; vault: string },
  useNosanaApiKey: false,
  postMessage: vi.fn(),
  generate: vi.fn(async (message: string) => `wallet:${message}`),
  signMessage: vi.fn(async (message: string) => `apikey:${message}`),
}));

vi.mock("worker_threads", () => ({
  workerData: state.workerData,
  parentPort: { postMessage: state.postMessage },
}));

vi.mock("../../../../../../worker/Worker.js", () => ({
  prepareWorker: vi.fn(async (data: Record<string, unknown>) => ({
    ...data,
    useNosanaApiKey: state.useNosanaApiKey,
    kit: {
      authorization: { generate: state.generate },
      api: { auth: { signMessage: state.signMessage } },
    },
  })),
}));

async function runWorker(
  data: { includeTime?: boolean; message?: string },
  { useNosanaApiKey = false } = {},
): Promise<void> {
  for (const key of Object.keys(state.workerData)) delete state.workerData[key as keyof typeof state.workerData];
  Object.assign(state.workerData, { vault: "encrypted-vault-key", ...data });
  state.useNosanaApiKey = useNosanaApiKey;
  vi.resetModules();
  await import("./worker.js");
}

describe("getDeploymentHeaders worker", () => {
  beforeEach(() => {
    state.postMessage.mockClear();
    state.generate.mockClear();
    state.signMessage.mockClear();
  });

  it("signs DEPLOYMENT_HEADER when no message is provided", async () => {
    await runWorker({ includeTime: false });

    expect(state.generate).toHaveBeenCalledWith("DEPLOYMENT_HEADER", { includeTime: false });
    expect(state.postMessage).toHaveBeenCalledWith({ event: "GENERATED", header: "wallet:DEPLOYMENT_HEADER" });
  });

  it("signs the custom message with the wallet when provided", async () => {
    await runWorker({ includeTime: true, message: "custom message" });

    expect(state.generate).toHaveBeenCalledWith("custom message", { includeTime: true });
    expect(state.signMessage).not.toHaveBeenCalled();
    expect(state.postMessage).toHaveBeenCalledWith({ event: "GENERATED", header: "wallet:custom message" });
  });

  it("signs the custom message with the API key when the vault holds one", async () => {
    await runWorker({ includeTime: false, message: "custom message" }, { useNosanaApiKey: true });

    expect(state.signMessage).toHaveBeenCalledWith("custom message", { includeTime: false });
    expect(state.generate).not.toHaveBeenCalled();
    expect(state.postMessage).toHaveBeenCalledWith({ event: "GENERATED", header: "apikey:custom message" });
  });
});
