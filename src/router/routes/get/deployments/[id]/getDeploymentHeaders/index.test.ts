import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fastify, { type FastifyInstance, type RouteHandler } from "fastify";

import { addSchemas } from "../../../../../schema/index.schema.js";
import { GetDeploymentHeaderSchema } from "../../../../../schema/get/deployments/[id]/getDeploymentHeader.schema.js";
import { deploymentGetHeaderHandler } from "./index.js";

import type { DeploymentAggregation } from "../../../../../../types/index.js";

type SpawnedWorkerData = { includeTime: boolean; message?: string; vault: string };

const { spawned } = vi.hoisted(() => ({
  spawned: [] as SpawnedWorkerData[],
}));

// Replace the real VaultWorker (which decrypts the vault key and signs with the
// kit) with an emitter that records what it was given and echoes it back.
vi.mock("../../../../../../worker/Worker.js", async () => {
  const { EventEmitter } = await import("node:events");
  class FakeVaultWorker extends EventEmitter {
    constructor(_file: string, options: { workerData: SpawnedWorkerData }) {
      super();
      spawned.push(options.workerData);
      setImmediate(() =>
        this.emit("message", {
          event: "GENERATED",
          header: `signed:${options.workerData.message ?? "<unset>"}`,
        }),
      );
    }
  }
  return { VaultWorker: FakeVaultWorker };
});

const OWNER = "1".repeat(44);
const DEPLOYMENT = "2".repeat(44);
const VAULT = "3".repeat(44);
const VAULT_KEY = "encrypted-vault-key";
const AUTH_HEADERS = { "x-user-id": OWNER, authorization: "sig" };

const setDeployment: RouteHandler<{ Params: { deployment: string } }> = async (_req, res) => {
  res.locals.deployment = { vault: VAULT } as DeploymentAggregation;
};

async function buildServer(): Promise<FastifyInstance> {
  const server = fastify({ logger: false, ajv: { customOptions: { coerceTypes: false } } });
  addSchemas(server);

  const vaults = { findOne: vi.fn(async () => ({ vault: VAULT, owner: OWNER, vault_key: VAULT_KEY })) };
  server.decorateReply("locals", {
    getter() {
      if (!this._locals) this._locals = { db: { vaults } };
      return this._locals;
    },
    setter(value) {
      if (!this._locals) this._locals = { db: { vaults } };
      Object.assign(this._locals, value);
    },
  });

  server.get(
    "/deployments/:deployment/header",
    { schema: GetDeploymentHeaderSchema, preHandler: [setDeployment] },
    deploymentGetHeaderHandler,
  );
  await server.ready();
  return server;
}

describe("GET /deployments/:deployment/header", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    spawned.length = 0;
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it("passes a custom message through to the signing worker", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/deployments/${DEPLOYMENT}/header?message=${encodeURIComponent("hello world")}`,
      headers: AUTH_HEADERS,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ header: "signed:hello world" });
    expect(spawned).toEqual([{ includeTime: false, message: "hello world", vault: VAULT_KEY }]);
  });

  it("leaves message unset when not provided so the worker applies its default", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/deployments/${DEPLOYMENT}/header?includeTime=true`,
      headers: AUTH_HEADERS,
    });

    expect(res.statusCode).toBe(200);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toEqual({ includeTime: true, message: undefined, vault: VAULT_KEY });
  });

  it("rejects an empty message", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/deployments/${DEPLOYMENT}/header?message=`,
      headers: AUTH_HEADERS,
    });

    expect(res.statusCode).toBe(400);
    expect(spawned).toHaveLength(0);
  });

  it("rejects a non-boolean includeTime", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/deployments/${DEPLOYMENT}/header?includeTime=maybe`,
      headers: AUTH_HEADERS,
    });

    expect(res.statusCode).toBe(400);
    expect(spawned).toHaveLength(0);
  });
});
