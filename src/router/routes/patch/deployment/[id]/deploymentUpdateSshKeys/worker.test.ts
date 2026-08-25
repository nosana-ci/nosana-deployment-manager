import { describe, it, expect, vi, beforeEach } from "vitest";

import type { SignSshAuthorizationMessage } from "../../../../../../ssh/index.js";
import type { SshKeysWorkerData } from "./worker.js";

const state = vi.hoisted(() => ({
  // Single stable object: the mocked worker_threads module hands this exact
  // reference to the worker, so tests mutate it in place between runs.
  workerData: {} as SshKeysWorkerData,
  useNosanaApiKey: false,
  postMessage: vi.fn(),
  generate: vi.fn(async (message: string) => `wallet:${message}`),
  signMessage: vi.fn(async (message: string) => `apikey:${message}`),
  push: vi.fn(),
}));

vi.mock("worker_threads", () => ({
  workerData: state.workerData,
  parentPort: { postMessage: state.postMessage },
}));

type FakeSignKit = {
  authorization: { generate: (message: string, options: { includeTime: boolean }) => Promise<string> };
  api: { auth: { signMessage: (message: string, options: { includeTime: boolean }) => Promise<string> } };
};

vi.mock("../../../../../../worker/Worker.js", () => ({
  prepareWorker: vi.fn(async (data: Record<string, unknown>) => ({
    ...data,
    useNosanaApiKey: state.useNosanaApiKey,
    kit: {
      authorization: { generate: state.generate },
      api: { auth: { signMessage: state.signMessage } },
    },
  })),
  signAuthHeader: (kit: FakeSignKit, useApi: boolean, message: string, options: { includeTime: boolean }) =>
    useApi ? kit.api.auth.signMessage(message, options) : kit.authorization.generate(message, options),
  workerErrorFormatter: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

vi.mock("../../../../../../ssh/index.js", () => ({
  pushSshKeysToNode: (...a: unknown[]) => state.push(...a),
}));

const NODE = "N".repeat(44);
const JOB_A = "A".repeat(44);
const JOB_B = "B".repeat(44);
const KEYS = ["ssh-ed25519 AAAA a"];

async function runWorker(data: Omit<SshKeysWorkerData, "vault">, { useNosanaApiKey = false } = {}): Promise<void> {
  for (const key of Object.keys(state.workerData)) delete state.workerData[key as keyof SshKeysWorkerData];
  Object.assign(state.workerData, { vault: "encrypted-vault-key", ...data });
  state.useNosanaApiKey = useNosanaApiKey;
  vi.resetModules();
  await import("./worker.js");
}

function pushedSign(call: number): SignSshAuthorizationMessage {
  return (state.push.mock.calls[call][0] as { sign: SignSshAuthorizationMessage }).sign;
}

describe("deploymentUpdateSshKeys worker", () => {
  beforeEach(() => {
    state.postMessage.mockClear();
    state.generate.mockClear();
    state.signMessage.mockClear();
    state.push.mockReset().mockResolvedValue({ ok: true });
  });

  it("pushes the keys to each node with a signer bound to the vault wallet", async () => {
    await runWorker({ public_keys: KEYS, jobs: [{ job: JOB_A, node: NODE }, { job: JOB_B, node: NODE }] });

    expect(state.push).toHaveBeenCalledWith({ node: NODE, job: JOB_A, public_keys: KEYS, sign: expect.any(Function) });
    expect(state.push).toHaveBeenCalledWith({ node: NODE, job: JOB_B, public_keys: KEYS, sign: expect.any(Function) });

    // The signer returns the standard authorization header untouched, signed
    // over the exact message with no timestamp appended.
    await expect(pushedSign(0)("a message")).resolves.toBe("wallet:a message");
    expect(state.generate).toHaveBeenCalledWith("a message", { includeTime: false });
    expect(state.signMessage).not.toHaveBeenCalled();

    expect(state.postMessage).toHaveBeenCalledWith({
      event: "PUSHED",
      results: [
        { job: JOB_A, node: NODE, status: "authorized" },
        { job: JOB_B, node: NODE, status: "authorized" },
      ],
    });
  });

  it("signs through the API when the vault holds an API key", async () => {
    await runWorker({ public_keys: KEYS, jobs: [{ job: JOB_A, node: NODE }] }, { useNosanaApiKey: true });

    await expect(pushedSign(0)("a message")).resolves.toBe("apikey:a message");
    expect(state.signMessage).toHaveBeenCalledWith("a message", { includeTime: false });
    expect(state.generate).not.toHaveBeenCalled();
  });

  it("reports a rejected or unreachable node per job without failing the others", async () => {
    state.push
      .mockResolvedValueOnce({ ok: false, error: "public_keys[0]: 400: bad signature" })
      .mockResolvedValueOnce({ ok: true });

    await runWorker({ public_keys: KEYS, jobs: [{ job: JOB_A, node: NODE }, { job: JOB_B, node: NODE }] });

    expect(state.postMessage).toHaveBeenCalledWith({
      event: "PUSHED",
      results: [
        { job: JOB_A, node: NODE, status: "failed", error: "public_keys[0]: 400: bad signature" },
        { job: JOB_B, node: NODE, status: "authorized" },
      ],
    });
  });

  it("reports an unexpected push failure as that job's failure", async () => {
    state.push.mockRejectedValueOnce(new Error("worker died"));

    await runWorker({ public_keys: KEYS, jobs: [{ job: JOB_A, node: NODE }] });

    expect(state.postMessage).toHaveBeenCalledWith({
      event: "PUSHED",
      results: [{ job: JOB_A, node: NODE, status: "failed", error: "worker died" }],
    });
  });
});
