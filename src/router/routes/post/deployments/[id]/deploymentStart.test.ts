import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fastify, { type FastifyInstance, type RouteHandler } from "fastify";

import { deploymentStartHandler } from "./deploymentStart.js";

import type { DeploymentDocument } from "../../../../../types/index.js";

const OWNER = "1".repeat(44);
const DEPLOYMENT = "2".repeat(44);
const AUTH_HEADERS = { "x-user-id": OWNER, authorization: "sig" };

const current = { status: "STOPPED" };
const setDeployment: RouteHandler<{ Params: { deployment: string } }> = async (_req, res) => {
  res.locals.deployment = { id: DEPLOYMENT, status: current.status, run: 4 } as unknown as DeploymentDocument;
};

const db = { deployments: { updateOne: vi.fn() } };

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

  server.post("/deployments/:deployment/start", { preHandler: [setDeployment] }, deploymentStartHandler);
  await server.ready();
  return server;
}

describe("POST /deployments/:deployment/start", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    current.status = "STOPPED";
    db.deployments.updateOne.mockReset().mockResolvedValue({ acknowledged: true, matchedCount: 1 });
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
  });

  const start = () =>
    server.inject({ method: "POST", url: `/deployments/${DEPLOYMENT}/start`, headers: AUTH_HEADERS });

  it("opens a new run in the same write that moves the deployment to STARTING", async () => {
    const res = await start();

    expect(res.statusCode).toBe(200);
    expect(db.deployments.updateOne).toHaveBeenCalledExactlyOnceWith(
      { id: { $eq: DEPLOYMENT }, owner: { $eq: OWNER } },
      { $set: { status: "STARTING", updated_at: expect.any(Date) }, $inc: { run: 1 } }
    );
  });

  it("refuses a deployment that is running, without touching its run", async () => {
    current.status = "RUNNING";

    const res = await start();

    expect(res.statusCode).toBe(500);
    expect(db.deployments.updateOne).not.toHaveBeenCalled();
  });
});
