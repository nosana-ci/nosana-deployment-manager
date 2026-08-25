import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fastify, { type FastifyInstance, type RouteHandler } from "fastify";

import { addSchemas } from "../../../../schema/index.schema.js";
import { DeploymentUpdateActiveRevisionSchema } from "../../../../schema/patch/deployments/[id]/deploymentUpdateActiveRevision.schema.js";
import { deploymentUpdateActiveRevisionHandler } from "./deploymentUpdateActiveRevision.js";

import type { DeploymentAggregation } from "../../../../../types/index.js";

const pin = vi.fn(async () => "QmRepinned");
vi.mock("../../../../../kit/index.js", () => ({ getKit: () => ({ ipfs: { pin } }) }));

const OWNER = "1".repeat(44);
const DEPLOYMENT = "2".repeat(44);
const VAULT = "3".repeat(44);
const AUTH_HEADERS = { "x-user-id": OWNER, authorization: "sig" };
const KEY_A = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB0XqCL4vLIsYRvd5VmtbOJ8IEKDJpjaVWQ5lmxWVTq5 a";

const DEFINITION = { version: "0.1", type: "container", ops: [] };

const deploymentDoc: {
  id: string;
  vault: string;
  active_revision: number;
  confidential: boolean;
  ssh_public_keys?: string[];
} = { id: DEPLOYMENT, vault: VAULT, active_revision: 2, confidential: false };

const setDeployment: RouteHandler<{ Params: { deployment: string } }> = async (_req, res) => {
  res.locals.deployment = deploymentDoc as unknown as DeploymentAggregation;
};

const db = {
  revisions: { findOne: vi.fn(), updateOne: vi.fn() },
  deployments: { updateOne: vi.fn() },
};

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
    "/deployments/:deployment/update-active-revision",
    { schema: DeploymentUpdateActiveRevisionSchema, preHandler: [setDeployment] },
    deploymentUpdateActiveRevisionHandler
  );
  await server.ready();
  return server;
}

describe("PATCH /deployments/:deployment/update-active-revision", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    pin.mockClear();
    deploymentDoc.confidential = false;
    deploymentDoc.ssh_public_keys = undefined;
    db.revisions.findOne.mockReset().mockResolvedValue({ revision: 1, job_definition: DEFINITION });
    db.revisions.updateOne.mockReset().mockResolvedValue({ acknowledged: true });
    db.deployments.updateOne.mockReset().mockResolvedValue({ acknowledged: true });
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
  });

  const activate = (active_revision = 1) =>
    server.inject({
      method: "PATCH",
      url: `/deployments/${DEPLOYMENT}/update-active-revision`,
      headers: AUTH_HEADERS,
      payload: { active_revision },
    });

  it("re-pins the activated revision against the deployment's current keys", async () => {
    deploymentDoc.ssh_public_keys = [KEY_A];

    const res = await activate();

    expect(res.statusCode).toBe(200);
    expect(pin).toHaveBeenCalledWith({ ...DEFINITION, ssh: { public_keys: [KEY_A] } });
    expect(db.revisions.updateOne).toHaveBeenCalledWith(
      { deployment: DEPLOYMENT, revision: 1 },
      { $set: { ipfs_definition_hash: "QmRepinned" } }
    );
    // Keys unchanged — the deployment's ssh field is not rewritten.
    expect(db.deployments.updateOne).toHaveBeenCalledWith(
      expect.anything(),
      {
        $set: {
          active_revision: 1,
          endpoints: [],
          updated_at: expect.any(Date),
        },
      }
    );
  });

  it("refreshes a stale pin back to the bare definition after keys were revoked", async () => {
    // No keys on the deployment; the revision's stored hash may still embed the
    // set that existed when it was written — activation re-pins it clean.
    const res = await activate();

    expect(res.statusCode).toBe(200);
    expect(pin).toHaveBeenCalledWith(DEFINITION);
    expect(db.revisions.updateOne).toHaveBeenCalledWith(
      { deployment: DEPLOYMENT, revision: 1 },
      { $set: { ipfs_definition_hash: "QmRepinned" } }
    );
  });

  it("leaves a confidential revision's pin entirely untouched", async () => {
    deploymentDoc.confidential = true;

    const res = await activate();

    expect(res.statusCode).toBe(200);
    expect(pin).not.toHaveBeenCalled();
    expect(db.revisions.updateOne).not.toHaveBeenCalled();
  });

  it("rejects an unknown revision", async () => {
    db.revisions.findOne.mockResolvedValue(null);

    const res = await activate(9);

    expect(res.statusCode).toBe(400);
    expect(pin).not.toHaveBeenCalled();
    expect(db.deployments.updateOne).not.toHaveBeenCalled();
  });
});
