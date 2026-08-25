import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fastify, { type FastifyInstance, type RouteHandler } from "fastify";

import { addSchemas } from "../../../../../schema/index.schema.js";
import { DeploymentUpdateSshKeysSchema } from "../../../../../schema/patch/deployments/[id]/deploymentUpdateSshKeys.schema.js";
import { deploymentUpdateSshKeysHandler } from "./index.js";

import type { DeploymentAggregation } from "../../../../../../types/index.js";
import type { SshKeysWorkerData } from "./worker.js";

const { spawned } = vi.hoisted(() => ({
  spawned: [] as SshKeysWorkerData[],
}));

// Replace the real VaultWorker (vault decrypt + signing + node HTTP) with an
// emitter that records its input and reports every job as authorized.
vi.mock("../../../../../../worker/Worker.js", async () => {
  const { EventEmitter } = await import("node:events");
  class FakeVaultWorker extends EventEmitter {
    constructor(_file: string, options: { workerData: SshKeysWorkerData }) {
      super();
      spawned.push(options.workerData);
      setImmediate(() =>
        this.emit("message", {
          event: "PUSHED",
          results: options.workerData.jobs.map(({ job, node }) => ({ job, node, status: "authorized" })),
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

const DEFINITION = { version: "0.1", type: "container", ops: [] };

const deploymentDoc = { id: DEPLOYMENT, vault: VAULT, active_revision: 2, confidential: false };

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

  server.patch(
    "/deployments/:deployment/update-ssh-keys",
    { schema: DeploymentUpdateSshKeysSchema, preHandler: [setDeployment] },
    deploymentUpdateSshKeysHandler
  );
  await server.ready();
  return server;
}

describe("PATCH /deployments/:deployment/update-ssh-keys", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    spawned.length = 0;
    deploymentDoc.confidential = false;
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

  afterEach(async () => {
    await server.close();
  });

  const patch = (body: unknown) =>
    server.inject({
      method: "PATCH",
      url: `/deployments/${DEPLOYMENT}/update-ssh-keys`,
      headers: AUTH_HEADERS,
      payload: body,
    });

  it("stores the keys on the deployment and pushes them to every running job's node", async () => {
    const jobA = "A".repeat(44);
    const jobB = "B".repeat(44);
    runningJobs([
      { job: jobA, node: NODE },
      { job: jobB, node: NODE },
    ]);

    const res = await patch({ public_keys: [` ${KEY_A} `] });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.public_keys).toEqual([KEY_A]); // trimmed
    expect(body.jobs).toEqual([
      { job: jobA, node: NODE, status: "authorized" },
      { job: jobB, node: NODE, status: "authorized" },
    ]);

    // The active revision's definition is re-pinned with the new keys merged
    // in, and its hash is updated in place — no new revision.
    expect(db.revisions.findOne).toHaveBeenCalledWith(
      { deployment: DEPLOYMENT, revision: 2 },
      { projection: { job_definition: 1 } }
    );
    expect(pin).toHaveBeenCalledWith({ ...DEFINITION, ssh: { public_keys: [KEY_A] } });
    expect(db.revisions.updateOne).toHaveBeenCalledWith(
      { deployment: DEPLOYMENT, revision: 2 },
      { $set: { ipfs_definition_hash: "QmMerged" } }
    );
    expect(db.deployments.updateOne).toHaveBeenCalledWith(
      { id: { $eq: DEPLOYMENT }, owner: { $eq: OWNER } },
      { $set: { ssh_public_keys: [KEY_A], updated_at: expect.any(Date) } }
    );
    // Only RUNNING jobs with a node are targeted.
    expect(db.jobs.find).toHaveBeenCalledWith(
      { deployment: DEPLOYMENT, state: "RUNNING", node: { $ne: null } },
      expect.anything()
    );
    expect(spawned).toEqual([
      {
        vault: VAULT_KEY,
        public_keys: [KEY_A],
        jobs: [
          { job: jobA, node: NODE },
          { job: jobB, node: NODE },
        ],
      },
    ]);
    expect(db.events.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: DEPLOYMENT,
        type: "SSH_KEYS_UPDATED",
        message: expect.stringContaining("2/2 running job(s)"),
      })
    );
  });

  it("does not spawn the signing worker when nothing is running", async () => {
    const res = await patch({ public_keys: [KEY_A] });

    expect(res.statusCode).toBe(200);
    expect(res.json().jobs).toEqual([]);
    expect(spawned).toHaveLength(0);
    expect(db.deployments.updateOne).toHaveBeenCalledTimes(1);
  });

  it("revokes SSH access on an empty set: bare re-pin, ssh block removed, no node calls", async () => {
    runningJobs([{ job: "A".repeat(44), node: NODE }]);

    const res = await patch({ public_keys: [] });

    expect(res.statusCode).toBe(200);
    // The active revision's hash goes back to the plain definition's pin.
    expect(pin).toHaveBeenCalledWith(DEFINITION);
    expect(db.revisions.updateOne).toHaveBeenCalledWith(
      { deployment: DEPLOYMENT, revision: 2 },
      { $set: { ipfs_definition_hash: "QmMerged" } }
    );
    expect(db.deployments.updateOne).toHaveBeenCalledWith(
      expect.anything(),
      { $set: { updated_at: expect.any(Date) }, $unset: { ssh_public_keys: "" } }
    );
    // The node has no key-removal route: nothing to push, running jobs keep
    // the keys they started with.
    expect(db.jobs.find).not.toHaveBeenCalled();
    expect(spawned).toHaveLength(0);
    expect(res.json().jobs).toEqual([]);
    expect(db.events.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("running jobs keep") })
    );
  });

  it("never touches the revision pin for a confidential deployment", async () => {
    deploymentDoc.confidential = true;

    const res = await patch({ public_keys: [KEY_A] });

    expect(res.statusCode).toBe(200);
    // Confidential definitions must stay off public IPFS — keys included. The
    // keys still land on the deployment (served via the job-definition route).
    expect(db.revisions.findOne).not.toHaveBeenCalled();
    expect(pin).not.toHaveBeenCalled();
    expect(db.revisions.updateOne).not.toHaveBeenCalled();
    expect(db.deployments.updateOne).toHaveBeenCalledWith(
      expect.anything(),
      { $set: { ssh_public_keys: [KEY_A], updated_at: expect.any(Date) } }
    );
  });

  it("rejects an invalid key before touching the deployment", async () => {
    const res = await patch({ public_keys: [KEY_A, "not a key"] });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/public_keys\[1\]/);
    expect(db.deployments.updateOne).not.toHaveBeenCalled();
    expect(spawned).toHaveLength(0);
  });

  it("rejects a body without public_keys", async () => {
    const res = await patch({});

    expect(res.statusCode).toBe(400);
    expect(db.deployments.updateOne).not.toHaveBeenCalled();
  });

  it("fails before persisting when the deployment's vault cannot be found", async () => {
    db.vaults.findOne.mockResolvedValue(null);

    const res = await patch({ public_keys: [KEY_A] });

    expect(res.statusCode).toBe(500);
    expect(db.deployments.updateOne).not.toHaveBeenCalled();
  });
});
