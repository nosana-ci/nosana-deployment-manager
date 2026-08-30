import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const config = vi.hoisted(() => ({
  frps_public_address: "node.k8s.test.nos.ci",
  network: "devnet",
}));

vi.mock("../config/index.js", () => ({
  getConfig: () => config,
}));

import { getNodeUrl, pushSshKeysToNode } from "./nodeClient.js";

const NODE = "N".repeat(44);
const JOB = "J".repeat(44);
const KEY_A = "ssh-ed25519 AAAA alice";
const KEY_B = "ssh-ed25519 BBBB bob";
// Stands in for the timestamped owner header the node's middleware verifies.
const AUTH_HEADER = "DEPLOYMENT_HEADER:base58sig:1700000000000";

describe("nodeClient", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue(new Response("", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds the node URL from the public FRPS address", () => {
    expect(getNodeUrl(NODE)).toBe(`https://${NODE}.node.k8s.test.nos.ci`);
  });

  it("authorizes each key with the owner header and a key-only body", async () => {
    const result = await pushSshKeysToNode({
      node: NODE,
      job: JOB,
      public_keys: [KEY_A, KEY_B],
      authHeader: AUTH_HEADER,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const calls = fetchMock.mock.calls as Array<[string, NonNullable<Parameters<typeof fetch>[1]>]>;
    for (const [index, key] of [KEY_A, KEY_B].entries()) {
      const [url, init] = calls[index];
      expect(url).toBe(`https://${NODE}.node.k8s.test.nos.ci/job/${JOB}/ssh/authorize`);
      expect(init.method).toBe("POST");
      // The owner header authenticates the request; content-type stays JSON.
      expect(init.headers).toMatchObject({
        "content-type": "application/json",
        authorization: AUTH_HEADER,
      });
      expect(init.signal).toBeInstanceOf(AbortSignal);
      // The body only names the key — node/job come from the URL and route param.
      expect(JSON.parse(String(init.body))).toEqual({ sshPublicKey: key });
    }

    expect(result).toEqual({ ok: true });
  });

  it("reports a rejected key with the node's message and still tries the rest", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('{"error":"Unauthorized Request"}', { status: 401 }))
      .mockResolvedValueOnce(new Response("", { status: 201 }));

    const result = await pushSshKeysToNode({
      node: NODE,
      job: JOB,
      public_keys: [KEY_A, KEY_B],
      authHeader: AUTH_HEADER,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      ok: false,
      error: 'public_keys[0]: 401: {"error":"Unauthorized Request"}',
    });
  });

  it("reports a network error as that key's failure, without throwing", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await pushSshKeysToNode({
      node: NODE,
      job: JOB,
      public_keys: [KEY_A],
      authHeader: AUTH_HEADER,
    });

    expect(result).toEqual({ ok: false, error: "public_keys[0]: Error ECONNREFUSED" });
  });
});
