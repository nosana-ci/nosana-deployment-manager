import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fastify, { type FastifyInstance, type RouteHandler } from "fastify";

import { deploymentCreateRevisionHandler } from "./deploymentCreateRevision.js";

import type { DeploymentDocument } from "../../../../../types/index.js";

const createNewDeploymentRevision = vi.fn();
vi.mock("../create/deploymentCreate.factory.js", () => ({
  createNewDeploymentRevision: (...a: unknown[]) => createNewDeploymentRevision(...a),
}));

const OWNER = "1".repeat(44);
const DEPLOYMENT = "2".repeat(44);
const VAULT = "3".repeat(44);
const AUTH_HEADERS = { "x-user-id": OWNER, authorization: "sig" };
const DEFINITION = { version: "0.1", type: "container", ops: [] };

// Rolled back: revision 2 is active while revision 3 exists.
const setDeployment: RouteHandler<{ Params: { deployment: string } }> = async (_req, res) => {
  res.locals.deployment = { id: DEPLOYMENT, vault: VAULT, active_revision: 2, confidential: false } as unknown as DeploymentDocument;
};

const db = {
  revisions: { findOne: vi.fn(), insertOne: vi.fn(), deleteOne: vi.fn(), find: vi.fn() },
  deployments: { updateOne: vi.fn() },
};

async function buildServer(): Promise<FastifyInstance> {
  const server = fastify({ logger: false });

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

  server.post("/deployments/:deployment/create-revision", { preHandler: [setDeployment] }, deploymentCreateRevisionHandler);
  await server.ready();
  return server;
}

describe("POST /deployments/:deployment/create-revision", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    createNewDeploymentRevision.mockReset().mockImplementation(async (latest: number) => ({
      revision: { revision: latest + 1, deployment: DEPLOYMENT, ipfs_definition_hash: "Qm", job_definition: DEFINITION, created_at: new Date() },
      endpoints: [],
    }));
    db.revisions.findOne.mockReset().mockResolvedValue({ revision: 3 });
    db.revisions.insertOne.mockReset().mockResolvedValue({ acknowledged: true });
    db.revisions.deleteOne.mockReset().mockResolvedValue({ acknowledged: true });
    db.revisions.find.mockReset().mockReturnValue({ toArray: async () => [] });
    db.deployments.updateOne.mockReset().mockResolvedValue({ acknowledged: true, matchedCount: 1 });
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
  });

  const create = () =>
    server.inject({
      method: "POST",
      url: `/deployments/${DEPLOYMENT}/create-revision`,
      headers: AUTH_HEADERS,
      payload: DEFINITION,
    });

  it("numbers the revision after the highest one there is, not the active one (after a rollback)", async () => {
    const res = await create();

    expect(res.statusCode).toBe(200);
    expect(db.revisions.findOne).toHaveBeenCalledWith(
      { deployment: DEPLOYMENT },
      { sort: { revision: -1 }, projection: { revision: 1 } }
    );
    expect(createNewDeploymentRevision.mock.calls[0][0]).toBe(3);
    expect(db.revisions.insertOne).toHaveBeenCalledWith(expect.objectContaining({ revision: 4 }));
    expect(res.json()).toMatchObject({ active_revision: 4 });
  });

  it("answers 404 and removes the new revision when the deployment went away", async () => {
    db.deployments.updateOne.mockResolvedValue({ acknowledged: true, matchedCount: 0 });

    const res = await create();

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Deployment not found." });
    expect(db.revisions.deleteOne).toHaveBeenCalledWith({ deployment: DEPLOYMENT, revision: 4 });
  });
});
