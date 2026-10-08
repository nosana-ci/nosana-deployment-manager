import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fastify, { type FastifyInstance, type RouteHandler } from "fastify";

import { addSchemas } from "../../../../schema/index.schema.js";
import { DeploymentUpdateRequirementsSchema } from "../../../../schema/patch/deployments/[id]/deploymentUpdateRequirements.schema.js";
import { deploymentUpdateRequirementsHandler } from "./deploymentUpdateRequirements.js";

import type { DeploymentDocument } from "../../../../../types/index.js";

const OWNER = "1".repeat(44);
const DEPLOYMENT = "2".repeat(44);
const OLD_MARKET = "3".repeat(44);
const NEW_MARKET = "4".repeat(44);
const AUTH_HEADERS = { "x-user-id": OWNER, authorization: "sig" };
const REQUIREMENTS = { name: "NVIDIA GeForce RTX 4090", ram_gb: 64, country: "NL" };

const setDeployment: RouteHandler<{ Params: { deployment: string } }> = async (_req, res) => {
  res.locals.deployment = { id: DEPLOYMENT, market: OLD_MARKET, requirements: null } as unknown as DeploymentDocument;
};

const db = {
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
    "/deployments/:deployment/update-requirements",
    { schema: DeploymentUpdateRequirementsSchema, preHandler: [setDeployment] },
    deploymentUpdateRequirementsHandler
  );
  await server.ready();
  return server;
}

describe("PATCH /deployments/:deployment/update-requirements", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    db.deployments.updateOne.mockReset().mockResolvedValue({ acknowledged: true });
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
  });

  const update = (payload: unknown) =>
    server.inject({
      method: "PATCH",
      url: `/deployments/${DEPLOYMENT}/update-requirements`,
      headers: AUTH_HEADERS,
      payload,
    });

  it("replaces the requirements on the same market, scoped to the owner", async () => {
    const res = await update({ requirements: REQUIREMENTS, market: OLD_MARKET });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      requirements: REQUIREMENTS,
      market: OLD_MARKET,
      updated_at: expect.any(String),
    });
    expect(db.deployments.updateOne).toHaveBeenCalledWith(
      { id: { $eq: DEPLOYMENT }, owner: { $eq: OWNER } },
      { $set: { requirements: REQUIREMENTS, market: OLD_MARKET, updated_at: expect.any(Date) } }
    );
  });

  it("moves to a new market in the same write", async () => {
    const res = await update({ requirements: REQUIREMENTS, market: NEW_MARKET });

    expect(res.statusCode).toBe(200);
    expect(res.json().market).toBe(NEW_MARKET);
    expect(db.deployments.updateOne).toHaveBeenCalledWith(
      { id: { $eq: DEPLOYMENT }, owner: { $eq: OWNER } },
      { $set: { requirements: REQUIREMENTS, market: NEW_MARKET, updated_at: expect.any(Date) } }
    );
  });

  it("rejects a market that is not a public key", async () => {
    const res = await update({ requirements: REQUIREMENTS, market: "not-a-key" });

    expect(res.statusCode).toBe(400);
    expect(db.deployments.updateOne).not.toHaveBeenCalled();
  });

  it("clears the requirements with null", async () => {
    const res = await update({ requirements: null, market: OLD_MARKET });

    expect(res.statusCode).toBe(200);
    expect(res.json().requirements).toBeNull();
    expect(db.deployments.updateOne).toHaveBeenCalledWith(expect.anything(), {
      $set: { requirements: null, market: OLD_MARKET, updated_at: expect.any(Date) },
    });
  });

  it.each([
    ["an empty set", {}],
    ["a value that is not a number, string or boolean", { ram_gb: [64] }],
  ])("rejects %s", async (_case, requirements) => {
    const res = await update({ requirements, market: OLD_MARKET });

    expect(res.statusCode).toBe(400);
    expect(db.deployments.updateOne).not.toHaveBeenCalled();
  });

  it.each([
    ["requirements", { market: OLD_MARKET }],
    ["a market", { requirements: REQUIREMENTS }],
  ])("rejects a body without %s", async (_case, payload) => {
    const res = await update(payload);

    expect(res.statusCode).toBe(400);
    expect(db.deployments.updateOne).not.toHaveBeenCalled();
  });

  it("reports a failed write", async () => {
    db.deployments.updateOne.mockResolvedValue({ acknowledged: false });

    const res = await update({ requirements: REQUIREMENTS, market: OLD_MARKET });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "Failed to update deployment requirements." });
  });
});
