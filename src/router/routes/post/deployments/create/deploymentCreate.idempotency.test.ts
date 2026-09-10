import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { afterAll, beforeAll, beforeEach, expect, it, describe, vi } from "vitest";
import { setRepository } from "../../../../../repositories/index.js";
import addIndex from "../../../../../connection/docdb/migrations/18-addDeploymentIdempotencyIndex.js";

vi.mock("typia", () => ({ default: { validate: () => ({ success: true }) } }));
vi.mock("../../vaults/createSharedVault/createSharedVaultFactory.js", () => ({
  getOrCreateVault: async () => ({ vault: "vault" }),
  VaultNotFoundError: class extends Error {},
}));
vi.mock("./deploymentCreate.factory.js", () => ({
  hasExposedPorts: () => false,
  createDeployment: async ({ idempotency_key }: { idempotency_key?: string }) => {
    const id = randomUUID(), now = new Date();
    return {
      deployment: { ...(idempotency_key && { idempotency_key }), id, owner: "owner", status: "DRAFT", created_at: now, updated_at: now },
      revision: { deployment: id, revision: 1 },
    };
  },
}));
import { deploymentsHandler } from "../../../get/deployments/list.js";
import { deploymentCreateHandler } from "./deploymentCreate.js";

describe.skipIf(!process.env.DEPLOYMENT_CREATE_TEST_MONGO)("create key constraint", () => {
  const client = new MongoClient(process.env.DEPLOYMENT_CREATE_TEST_MONGO ?? "mongodb://localhost:27017");
  const database = client.db("create_key_test");
  const db = { deployments: database.collection("deployments"), revisions: database.collection("revisions") };
  const call = async (key?: string, autostart = false) => {
    const res = { locals: { db }, log: { error: vi.fn() }, statusCode: 200,
      status(code: number) { this.statusCode = code; return this; },
      send(body: unknown) { return body; },
    };
    const req = { headers: { "x-user-id": "owner" }, body: { idempotency_key: key, autostart }, log: { debug: vi.fn() } };
    // Exercise the handler with real collections, without Fastify transport or external funding.
    const result = await deploymentCreateHandler.call(null as never, req as never, res as never);
    return { status: res.statusCode, result };
  };
  beforeAll(async () => { await client.connect(); setRepository(client, database); });
  beforeEach(async () => { await database.dropDatabase(); await database.createCollection("revisions"); await addIndex(database); });
  afterAll(async () => { await database.dropDatabase(); await client.close(); });
  it("allows one concurrent create, rejects retries and keeps the key out of the response", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => call("request", true)));
    expect(results.filter(r => r.status === 200)).toHaveLength(1);
    expect(results.filter(r => r.status === 409)).toHaveLength(7);
    expect(await db.deployments.countDocuments()).toBe(1);
    expect(await db.revisions.countDocuments()).toBe(1);
    expect(await db.deployments.findOne({})).toMatchObject({ status: "STARTING", idempotency_key: "request" });
    expect(results.find(r => r.status === 200)?.result).not.toHaveProperty("idempotency_key");
    expect((await call("request")).status).toBe(409);
  });
  it("leaves unkeyed creates unrestricted and scopes keys by owner", async () => {
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(200);
    expect((await call("request")).status).toBe(200);
    await expect(db.deployments.insertOne({ owner: "another", idempotency_key: "request" })).resolves.toBeDefined();
  });
  it("fetches by key only within the authenticated owner", async () => {
    await call("lookup");
    await db.deployments.insertOne({ owner: "another", idempotency_key: "lookup", created_at: new Date() });
    const req = { headers: { "x-user-id": "owner" }, query: { idempotency_key: "lookup" }, log: { error: vi.fn() } };
    const res = { status: vi.fn(), send: vi.fn() };
    const result = await deploymentsHandler.call(null as never, req as never, res as never) as { deployments: { owner: string }[] };
    expect(result.deployments).toHaveLength(1);
    expect(result.deployments[0].owner).toBe("owner");
  });
  it("rolls back a failed revision and allows the same key to retry", async () => {
    const spy = vi.spyOn(db.revisions, "insertOne").mockRejectedValueOnce(new Error("failure"));
    expect((await call("request")).status).toBe(500);
    spy.mockRestore();
    expect(await db.deployments.countDocuments()).toBe(0);
    expect((await call("request")).status).toBe(200);
  });
});
