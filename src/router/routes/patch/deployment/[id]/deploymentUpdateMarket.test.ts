import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fastify, { type FastifyInstance, type RouteHandler } from "fastify";

import { addSchemas } from "../../../../schema/index.schema.js";
import { DeploymentUpdateMarketSchema } from "../../../../schema/patch/deployments/[id]/deploymentUpdateMarket.schema.js";
import { deploymentUpdateMarketHandler } from "./deploymentUpdateMarket.js";

import type { DeploymentDocument } from "../../../../../types/index.js";

const OWNER = "1".repeat(44);
const DEPLOYMENT = "2".repeat(44);
const OLD_MARKET = "3".repeat(44);
const NEW_MARKET = "4".repeat(44);
const AUTH_HEADERS = { "x-user-id": OWNER, authorization: "sig" };

const setDeployment: RouteHandler<{ Params: { deployment: string } }> = async (_req, res) => {
  res.locals.deployment = { id: DEPLOYMENT, market: OLD_MARKET } as unknown as DeploymentDocument;
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
    "/deployments/:deployment/update-market",
    { schema: DeploymentUpdateMarketSchema, preHandler: [setDeployment] },
    deploymentUpdateMarketHandler
  );
  await server.ready();
  return server;
}

describe("PATCH /deployments/:deployment/update-market", () => {
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
      url: `/deployments/${DEPLOYMENT}/update-market`,
      headers: AUTH_HEADERS,
      payload,
    });

  it("writes the new market, scoped to the owner, and echoes it back", async () => {
    const res = await update({ market: NEW_MARKET });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ market: NEW_MARKET, updated_at: expect.any(String) });
    expect(db.deployments.updateOne).toHaveBeenCalledWith(
      { id: { $eq: DEPLOYMENT }, owner: { $eq: OWNER }, market: { $ne: NEW_MARKET } },
      { $set: { market: NEW_MARKET, updated_at: expect.any(Date) } }
    );
  });

  it("trims surrounding whitespace off the market", async () => {
    const res = await update({ market: ` ${"5".repeat(43)}` });

    expect(res.statusCode).toBe(200);
    expect(res.json().market).toBe("5".repeat(43));
  });

  it("rejects a market that is not a public key", async () => {
    const res = await update({ market: "not-a-key" });

    expect(res.statusCode).toBe(400);
    expect(db.deployments.updateOne).not.toHaveBeenCalled();
  });

  it("reports a failed write", async () => {
    db.deployments.updateOne.mockResolvedValue({ acknowledged: false });

    const res = await update({ market: NEW_MARKET });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "Failed to update deployment market." });
  });
});
