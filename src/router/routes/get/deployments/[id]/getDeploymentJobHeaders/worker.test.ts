import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  // Single stable object: the mocked worker_threads module hands this exact
  // reference to the worker, so tests mutate it in place between runs.
  workerData: {} as { jobs?: string[]; vault: string },
  useNosanaApiKey: false,
  postMessage: vi.fn(),
  generate: vi.fn(async (message: string) => `wallet:${message}`),
  signHeaders: vi.fn(async (messages: string[]) => messages.map((message) => `apikey:${message}`)),
}));

vi.mock("worker_threads", () => ({
  workerData: state.workerData,
  parentPort: { postMessage: state.postMessage },
}));

type FakeSignKit = {
  authorization: { generate: (message: string, options: { includeTime: boolean }) => Promise<string> };
  api: { auth: { signHeaders: (messages: string[], options: { includeTime: boolean }) => Promise<string[]> } };
};

vi.mock("../../../../../../worker/Worker.js", () => ({
  prepareWorker: vi.fn(async (data: Record<string, unknown>) => ({
    ...data,
    useNosanaApiKey: state.useNosanaApiKey,
    kit: {
      authorization: { generate: state.generate },
      api: { auth: { signHeaders: state.signHeaders } },
    },
  })),
  signAuthHeader: (kit: FakeSignKit, _useApi: boolean, message: string, options: { includeTime: boolean }) =>
    kit.authorization.generate(message, options),
  workerErrorFormatter: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

async function runWorker(jobs: string[], { useNosanaApiKey = false } = {}): Promise<void> {
  for (const key of Object.keys(state.workerData)) delete state.workerData[key as keyof typeof state.workerData];
  Object.assign(state.workerData, { vault: "encrypted-vault-key", jobs });
  state.useNosanaApiKey = useNosanaApiKey;
  vi.resetModules();
  await import("./worker.js");
}

describe("getDeploymentJobHeaders worker", () => {
  beforeEach(() => {
    state.postMessage.mockClear();
    state.generate.mockClear();
    state.signHeaders.mockClear();
  });

  it("signs each job address as a timestamped message with the wallet", async () => {
    await runWorker(["jobA", "jobB"]);

    expect(state.generate).toHaveBeenCalledTimes(2);
    expect(state.generate).toHaveBeenCalledWith("jobA", { includeTime: true });
    expect(state.generate).toHaveBeenCalledWith("jobB", { includeTime: true });
    expect(state.signHeaders).not.toHaveBeenCalled();
    expect(state.postMessage).toHaveBeenCalledWith({
      event: "GENERATED",
      headers: { jobA: "wallet:jobA", jobB: "wallet:jobB" },
    });
  });

  it("signs all jobs in one client manager call when the vault holds an API key", async () => {
    await runWorker(["jobA", "jobB"], { useNosanaApiKey: true });

    expect(state.signHeaders).toHaveBeenCalledTimes(1);
    expect(state.signHeaders).toHaveBeenCalledWith(["jobA", "jobB"], { includeTime: true });
    expect(state.generate).not.toHaveBeenCalled();
    expect(state.postMessage).toHaveBeenCalledWith({
      event: "GENERATED",
      headers: { jobA: "apikey:jobA", jobB: "apikey:jobB" },
    });
  });

  it("splits API-key signing into batches of 100 and keeps every job's own header", async () => {
    const jobs = Array.from({ length: 150 }, (_, i) => `job${i}`);
    await runWorker(jobs, { useNosanaApiKey: true });

    expect(state.signHeaders).toHaveBeenCalledTimes(2);
    expect(state.signHeaders.mock.calls[0][0]).toHaveLength(100);
    expect(state.signHeaders.mock.calls[1][0]).toHaveLength(50);
    const { headers } = state.postMessage.mock.calls[0][0] as { headers: Record<string, string> };
    expect(Object.keys(headers)).toHaveLength(150);
    expect(headers.job0).toBe("apikey:job0");
    expect(headers.job149).toBe("apikey:job149");
  });

  it("reports a signing failure instead of a partial map", async () => {
    state.generate.mockRejectedValueOnce(new Error("signer down"));
    await runWorker(["jobA", "jobB"]);

    expect(state.postMessage).toHaveBeenCalledWith({ event: "ERROR", error: "signer down" });
  });
});
