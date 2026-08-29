import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fastify, { type FastifyInstance, type RouteHandler } from "fastify";

import { addSchemas } from "../../../../schema/index.schema.js";
import { DeploymentUpdateStartupTimeoutSchema } from "../../../../schema/patch/deployments/[id]/deploymentUpdateStartupTimeout.schema.js";
import { deploymentUpdateStartupTimeoutHandler } from "./deploymentUpdateStartupTimeout.js";

import { DeploymentStrategy, type DeploymentAggregation, type Endpoint } from "../../../../../types/index.js";

const OWNER = "1".repeat(44);
const DEPLOYMENT = "2".repeat(44);

const AUTH_HEADERS = { "x-user-id": OWNER, authorization: "sig" };
const ENDPOINT: Endpoint = { opId: "op", port: 8080, url: "https://x.example" };

const deploymentDoc: {
  id: string;
  strategy: DeploymentStrategy;
  endpoints: Endpoint[];
} = { id: DEPLOYMENT, strategy: DeploymentStrategy.INFINITE, endpoints: [ENDPOINT] };

const setDeployment: RouteHandler<{ Params: { deployment: string } }> = async (_req, res) => {
  res.locals.deployment = deploymentDoc as unknown as DeploymentAggregation;
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
    "/deployments/:deployment/update-startup-timeout",
    { schema: DeploymentUpdateStartupTimeoutSchema, preHandler: [setDeployment] },
    deploymentUpdateStartupTimeoutHandler
  );
  await server.ready();
  return server;
}

describe("PATCH /deployments/:deployment/update-startup-timeout", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    deploymentDoc.strategy = DeploymentStrategy.INFINITE;
    deploymentDoc.endpoints = [ENDPOINT];
    db.deployments.updateOne.mockReset().mockResolvedValue({ acknowledged: true });
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
  });

  const update = (startup_timeout: unknown = 15) =>
    server.inject({
      method: "PATCH",
      url: `/deployments/${DEPLOYMENT}/update-startup-timeout`,
      headers: AUTH_HEADERS,
      payload: { startup_timeout },
    });

  it("writes the new startup timeout on an INFINITE deployment", async () => {
    const res = await update(15);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ startup_timeout: 15 });
    expect(db.deployments.updateOne).toHaveBeenCalledWith(
      {
        id: { $eq: DEPLOYMENT },
        owner: { $eq: OWNER },
        startup_timeout: { $ne: 15 },
      },
      { $set: { startup_timeout: 15, updated_at: expect.any(Date) } }
    );
  });

  it("rejects a non-INFINITE deployment", async () => {
    deploymentDoc.strategy = DeploymentStrategy.SIMPLE;

    const res = await update(15);

    expect(res.statusCode).toBe(400);
    expect(db.deployments.updateOne).not.toHaveBeenCalled();
  });

  it("rejects an INFINITE deployment that exposes no ports", async () => {
    deploymentDoc.endpoints = [];

    const res = await update(15);

    expect(res.statusCode).toBe(400);
    expect(db.deployments.updateOne).not.toHaveBeenCalled();
  });

  it("rejects a startup timeout below the minimum", async () => {
    const res = await update(0);

    expect(res.statusCode).toBe(400);
    expect(db.deployments.updateOne).not.toHaveBeenCalled();
  });
});
