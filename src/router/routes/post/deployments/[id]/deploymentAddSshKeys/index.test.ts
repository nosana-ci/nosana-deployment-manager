import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fastify, { type FastifyInstance, type RouteHandler } from "fastify";

import { addSchemas, DeploymentAddSshKeysSchema } from "../../../../../schema/index.schema.js";
import { deploymentAddSshKeysHandler } from "./index.js";

import type { DeploymentAggregation } from "../../../../../../types/index.js";
import type { SshKeysWorkerData } from "../../../../../../ssh/worker.js";

const { spawned } = vi.hoisted(() => ({ spawned: [] as SshKeysWorkerData[] }));

// Replace the real VaultWorker (vault decrypt + signing + node HTTP) with an
// emitter that records its input and reports every job as applied.
vi.mock("../../../../../../worker/Worker.js", async () => {
  const { EventEmitter } = await import("node:events");
  class FakeVaultWorker extends EventEmitter {
    constructor(_file: string, options: { workerData: SshKeysWorkerData }) {
      super();
      spawned.push(options.workerData);
      const status = options.workerData.operation === "revoke" ? "revoked" : "authorized";
      setImmediate(() =>
        this.emit("message", {
          event: "PUSHED",
          results: options.workerData.jobs.map(({ job, node }) => ({ job, node, status })),
        })
      );
    }
  }
  return { VaultWorker: FakeVaultWorker };
});

const pin = vi.fn(async () => "QmMerged");
vi.mock("../../../../../../kit/index.js", () => ({ getKit: () => ({ ipfs: { pin } }) }));

const OWNER = "1".repeat(44);
const DEPLOYMENT = "2".repeat(44);
const VAULT = "3".repeat(44);
const NODE = "4".repeat(44);
const VAULT_KEY = "encrypted-vault-key";
const AUTH_HEADERS = { "x-user-id": OWNER, authorization: "sig" };
const KEY_A = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB0XqCL4vLIsYRvd5VmtbOJ8IEKDJpjaVWQ5lmxWVTq5 a";
const KEY_B = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB0XqCL4vLIsYRvd5VmtbOJ8IEKDJpjaVWQ5lmxWVTq6 b";

const DEFINITION = { version: "0.1", type: "container", ops: [] };
const deploymentDoc: Record<string, unknown> = { id: DEPLOYMENT, updated_at: new Date("2026-09-01T00:00:00.000Z"), vault: VAULT, active_revision: 2, confidential: false };

const setDeployment: RouteHandler<{ Params: { deployment: string } }> = async (_req, res) => {
  res.locals.deployment = deploymentDoc as unknown as DeploymentAggregation;
};

const db = {
  vaults: { findOne: vi.fn() },
  deployments: { updateOne: vi.fn() },
  revisions: { findOne: vi.fn(), updateOne: vi.fn() },
  jobs: { find: vi.fn() },
  events: { insertOne: vi.fn() },
};

function runningJobs(jobs: Array<{ job: string; node: string | null }>) {
  db.jobs.find.mockReturnValue({ toArray: async () => jobs });
}

async function buildServer(): Promise<FastifyInstance> {
  const server = fastify({ logger: false, ajv: { customOptions: { coerceTypes: false } } });
  addSchemas(server);
  server.decorateReply("locals", {
    getter() {
      if (!this._locals) this._locals = { db };
      return this._locals;
    },
    setter(value) {
      if (!this._locals) this._locals = { db };
      Object.assign(this._locals, value);
    },
  });
  server.post(
    "/deployments/:deployment/ssh-keys",
    { schema: DeploymentAddSshKeysSchema, preHandler: [setDeployment] },
    deploymentAddSshKeysHandler
  );
  await server.ready();
  return server;
}

describe("POST /deployments/:deployment/ssh-keys", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    spawned.length = 0;
    deploymentDoc.confidential = false;
    delete deploymentDoc.ssh_public_keys;
    pin.mockClear();
    db.vaults.findOne.mockReset().mockResolvedValue({ vault: VAULT, owner: OWNER, vault_key: VAULT_KEY });
    db.deployments.updateOne.mockReset().mockResolvedValue({ acknowledged: true });
    db.revisions.findOne.mockReset().mockResolvedValue({ revision: 2, job_definition: DEFINITION });
    db.revisions.updateOne.mockReset().mockResolvedValue({ acknowledged: true });
    db.jobs.find.mockReset();
    db.events.insertOne.mockReset().mockResolvedValue({ acknowledged: true });
    runningJobs([]);
    server = await buildServer();
  });

  afterEach(async () => await server.close());

  const add = (body: unknown) =>
    server.inject({ method: "POST", url: `/deployments/${DEPLOYMENT}/ssh-keys`, headers: AUTH_HEADERS, payload: body });

  it("merges a new key into the set and authorizes it on every running job", async () => {
    deploymentDoc.ssh_public_keys = [KEY_A];
    const jobA = "A".repeat(44);
    runningJobs([{ job: jobA, node: NODE }]);

    const res = await add({ public_keys: [` ${KEY_B} `] });

    expect(res.statusCode).toBe(200);
    expect(res.json().public_keys).toEqual([KEY_A, KEY_B]);
    expect(res.json().jobs).toEqual([{ job: jobA, node: NODE, status: "authorized" }]);
    // The re-pinned definition carries the full set; only the new key is pushed.
    expect(pin).toHaveBeenCalledWith({ ...DEFINITION, ssh: { public_keys: [KEY_A, KEY_B] } });
    expect(db.deployments.updateOne).toHaveBeenCalledWith(
      { id: { $eq: DEPLOYMENT }, owner: { $eq: OWNER } },
      { $set: { ssh_public_keys: [KEY_A, KEY_B], updated_at: expect.any(Date) } }
    );
    expect(spawned).toEqual([
      { vault: VAULT_KEY, operation: "authorize", public_keys: [KEY_B], jobs: [{ job: jobA, node: NODE }] },
    ]);
    expect(db.events.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SSH_KEYS_UPDATED", message: expect.stringContaining("added") })
    );
  });

  it("ignores a key already present (same material, different comment) and pushes nothing", async () => {
    deploymentDoc.ssh_public_keys = [KEY_A];
    runningJobs([{ job: "A".repeat(44), node: NODE }]);

    const res = await add({ public_keys: [`ssh-ed25519 ${KEY_A.split(" ")[1]} other-comment`] });

    expect(res.statusCode).toBe(200);
    expect(res.json().public_keys).toEqual([KEY_A]);
    expect(res.json().jobs).toEqual([]);
    expect(db.jobs.find).not.toHaveBeenCalled();
    expect(spawned).toHaveLength(0);
    expect(res.json().updated_at).toBe("2026-09-01T00:00:00.000Z");
    expect(db.deployments.updateOne).not.toHaveBeenCalled();
    expect(db.events.insertOne).not.toHaveBeenCalled();
  });

  it("rejects an invalid key before touching the deployment", async () => {
    const res = await add({ public_keys: ["not a key"] });
    expect(res.statusCode).toBe(400);
    expect(db.deployments.updateOne).not.toHaveBeenCalled();
    expect(spawned).toHaveLength(0);
  });

  it("never touches the revision pin for a confidential deployment", async () => {
    deploymentDoc.confidential = true;
    const res = await add({ public_keys: [KEY_A] });
    expect(res.statusCode).toBe(200);
    expect(db.revisions.findOne).not.toHaveBeenCalled();
    expect(pin).not.toHaveBeenCalled();
  });

  it("fails before persisting when the deployment's vault cannot be found", async () => {
    db.vaults.findOne.mockResolvedValue(null);
    const res = await add({ public_keys: [KEY_A] });
    expect(res.statusCode).toBe(500);
    expect(db.deployments.updateOne).not.toHaveBeenCalled();
  });
});
