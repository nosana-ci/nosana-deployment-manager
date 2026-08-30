import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const config = vi.hoisted(() => ({
  frps_public_address: "node.k8s.test.nos.ci",
  network: "devnet",
}));

vi.mock("../config/index.js", () => ({
  getConfig: () => config,
}));

import { getNodeUrl, pushSshKeysToNode, buildSshAuthorizationMessage } from "./nodeClient.js";

const NODE = "N".repeat(44);
const JOB = "J".repeat(44);
const KEY_A = "ssh-ed25519 AAAA alice";
const KEY_B = "ssh-ed25519 BBBB bob";
// Stands in for the timestamped owner header the node's middleware verifies.
const AUTH_HEADER = "DEPLOYMENT_HEADER:base58sig:1700000000000";

describe("nodeClient", () => {
  const fetchMock = vi.fn();
  // Stands in for signAuthHeader: the kit's `<message>:<base58 signature>`.
  const sign = vi.fn(async (message: string) => `${message}:base58sig`);

  beforeEach(() => {
    config.network = "devnet";
    fetchMock.mockReset().mockResolvedValue(new Response("", { status: 201 }));
    sign.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds the node URL from the public FRPS address", () => {
    expect(getNodeUrl(NODE)).toBe(`https://${NODE}.node.k8s.test.nos.ci`);
  });

  it("builds the exact message the node's authorize route verifies", () => {
    const message = buildSshAuthorizationMessage({ job: JOB, node: NODE, sshPublicKey: KEY_A });

    expect(message).toBe(
      [
        "Nosana SSH Authorization v1",
        "",
        `job: ${JOB}`,
        `node: ${NODE}`,
        `sshUser: nosana-${JOB}`,
        `sshPublicKey: ${KEY_A}`,
        "network: devnet",
        "audience: nosana-ssh-gateway",
      ].join("\n")
    );
  });

  it("omits the network line on localnet so the node skips that check", () => {
    config.network = "localnet";

    const message = buildSshAuthorizationMessage({ job: JOB, node: NODE, sshPublicKey: KEY_A });

    expect(message).not.toContain("network:");
  });

  it("authorizes each key with the untouched signed message string", async () => {
    const result = await pushSshKeysToNode({
      node: NODE,
      job: JOB,
      public_keys: [KEY_A, KEY_B],
      sign,
      authHeader: AUTH_HEADER,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const calls = fetchMock.mock.calls as Array<[string, NonNullable<Parameters<typeof fetch>[1]>]>;
    const messages = sign.mock.calls.map(([message]) => message);
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

      // The body carries signAuthHeader's output as-is — never unwrapped.
      expect(messages[index]).toContain(`sshPublicKey: ${key}`);
      expect(JSON.parse(String(init.body))).toEqual({ authorization: `${messages[index]}:base58sig` });
    }

    expect(result).toEqual({ ok: true });
  });

  it("reports a rejected key with the node's message and still tries the rest", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('{"error":"Invalid SSH authorization signature"}', { status: 400 }))
      .mockResolvedValueOnce(new Response("", { status: 201 }));

    const result = await pushSshKeysToNode({
      node: NODE,
      job: JOB,
      public_keys: [KEY_A, KEY_B],
      sign,
      authHeader: AUTH_HEADER,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      ok: false,
      error: 'public_keys[0]: 400: {"error":"Invalid SSH authorization signature"}',
    });
  });

  it("reports a network error as that key's failure, without throwing", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await pushSshKeysToNode({
      node: NODE,
      job: JOB,
      public_keys: [KEY_A],
      sign,
      authHeader: AUTH_HEADER,
    });

    expect(result).toEqual({ ok: false, error: "public_keys[0]: Error ECONNREFUSED" });
  });

  it("reports a signing failure as that key's failure, without calling the node", async () => {
    sign.mockRejectedValueOnce(new Error("cannot sign"));

    const result = await pushSshKeysToNode({
      node: NODE,
      job: JOB,
      public_keys: [KEY_A],
      sign,
      authHeader: AUTH_HEADER,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: "public_keys[0]: Error cannot sign" });
  });
});
