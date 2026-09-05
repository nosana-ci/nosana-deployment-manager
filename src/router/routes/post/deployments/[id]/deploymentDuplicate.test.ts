import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fastify, { type FastifyInstance, type RouteHandler } from "fastify";

const pin = vi.fn(async () => "QmDuplicate");
vi.mock("../../../../../kit/index.js", () => ({ getKit: () => ({ ipfs: { pin } }) }));
vi.mock("../../../../../config/index.js", () => ({
  getConfig: () => ({
    confidential_by_default: false,
    frps_public_address: "node.k8s.test.nos.ci",
    default_minutes_before_timeout: 20,
  }),
}));
vi.mock("@solana/signers", () => ({
  generateKeyPairSigner: async () => ({ address: "D".repeat(44) }),
}));

import { addSchemas } from "../../../../schema/index.schema.js";
import { DeploymentDuplicateSchema } from "../../../../schema/post/deployments/[id]/deploymentDuplicate.schema.js";
import { deploymentDuplicateHandler } from "./deploymentDuplicate.js";

import type { DeploymentDocument } from "../../../../../types/index.js";

const OWNER = "1".repeat(44);
const SOURCE = "2".repeat(44);
const VAULT = "3".repeat(44);
const MARKET = "4".repeat(44);
const NEW_ID = "D".repeat(44);
const AUTH_HEADERS = { "x-user-id": OWNER, authorization: "sig" };

const DEFINITION = {
  version: "0.1",
  type: "container",
  deployment_id: SOURCE,
  meta: { trigger: "deployment-manager" },
  ops: [{ type: "container/run", id: "web", args: { image: "img", expose: 8080 } }],
};

const source = {
  id: SOURCE,
  vault: VAULT,
  market: MARKET,
  owner: OWNER,
  name: "orig",
  status: "ARCHIVED",
  strategy: "INFINITE",
  replicas: 2,
  timeout: 120,
  rotation_time: 30,
  endpoints: [{ opId: "web", port: 8080, url: "https://old.example", online: true }],
  active_revision: 3,
  confidential: false,
  created_at: new Date("2025-01-01T00:00:00Z"),
  updated_at: new Date("2025-01-02T00:00:00Z"),
} as unknown as DeploymentDocument;

const setDeployment: RouteHandler<{ Params: { deployment: string } }> = async (_req, res) => {
  res.locals.deployment = source;
};

const db = {
  revisions: { findOne: vi.fn(), insertOne: vi.fn() },
  deployments: { insertOne: vi.fn(), updateOne: vi.fn() },
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

  server.post(
    "/deployments/:deployment/duplicate",
    { schema: DeploymentDuplicateSchema, preHandler: [setDeployment] },
    deploymentDuplicateHandler
  );
  await server.ready();
  return server;
}

describe("POST /deployments/:deployment/duplicate", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    pin.mockClear();
    db.revisions.findOne.mockReset().mockResolvedValue({ revision: 3, job_definition: DEFINITION });
    db.revisions.insertOne.mockReset().mockResolvedValue({ acknowledged: true });
    db.deployments.insertOne.mockReset().mockResolvedValue({ acknowledged: true });
    db.deployments.updateOne.mockReset().mockResolvedValue({ acknowledged: true });
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
  });

  const duplicate = (payload: unknown = { name: "copy" }) =>
    server.inject({
      method: "POST",
      url: `/deployments/${SOURCE}/duplicate`,
      headers: AUTH_HEADERS,
      payload,
    });

  it("creates a DRAFT copy from the source's active revision and returns it", async () => {
    const res = await duplicate();

    expect(res.statusCode).toBe(200);
    expect(db.revisions.findOne).toHaveBeenCalledWith({ deployment: SOURCE, revision: 3 });

    const body = res.json();
    expect(body).toMatchObject({
      id: NEW_ID,
      name: "copy",
      vault: VAULT,
      market: MARKET,
      owner: OWNER,
      status: "DRAFT",
      strategy: "INFINITE",
      replicas: 2,
      timeout: 120,
      rotation_time: 30,
      confidential: false,
      active_revision: 1,
      active_jobs: 0,
    });
    // Endpoints are derived for the NEW id, and start offline.
    expect(body.endpoints).toHaveLength(1);
    expect(body.endpoints[0]).toMatchObject({ opId: "web", port: 8080, online: false });
    expect(body.endpoints[0].url).not.toBe("https://old.example");
  });

  it("persists revision 1 for the new deployment before the deployment itself", async () => {
    await duplicate();

    expect(db.revisions.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        revision: 1,
        deployment: NEW_ID,
        ipfs_definition_hash: "QmDuplicate",
        job_definition: expect.objectContaining({ deployment_id: NEW_ID }),
      })
    );
    expect(db.deployments.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ id: NEW_ID, status: "DRAFT", active_revision: 1 })
    );
    expect(db.revisions.insertOne.mock.invocationCallOrder[0]).toBeLessThan(
      db.deployments.insertOne.mock.invocationCallOrder[0]
    );
  });

  it("leaves the copy as a DRAFT when autostart is not requested", async () => {
    await duplicate();

    expect(db.deployments.updateOne).not.toHaveBeenCalled();
  });

  it("starts the copy right away with autostart, after inserting it as a DRAFT", async () => {
    const res = await duplicate({ name: "copy", autostart: true });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("STARTING");
    expect(db.deployments.insertOne).toHaveBeenCalledWith(expect.objectContaining({ status: "DRAFT" }));
    expect(db.deployments.updateOne).toHaveBeenCalledWith(
      { id: NEW_ID, owner: OWNER },
      { $set: { status: "STARTING", updated_at: expect.any(Date) } }
    );
    expect(db.deployments.insertOne.mock.invocationCallOrder[0]).toBeLessThan(
      db.deployments.updateOne.mock.invocationCallOrder[0]
    );
  });

  it("requires a name for the copy", async () => {
    const res = await duplicate({});

    expect(res.statusCode).toBe(400);
    expect(db.deployments.insertOne).not.toHaveBeenCalled();
  });

  it("fails cleanly when the source's active revision is missing", async () => {
    db.revisions.findOne.mockResolvedValue(null);

    const res = await duplicate();

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "Failed to duplicate deployment." });
    expect(db.deployments.insertOne).not.toHaveBeenCalled();
  });
});
