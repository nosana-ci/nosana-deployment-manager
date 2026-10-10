import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fastify, { type FastifyInstance } from "fastify";
import { ObjectId } from "mongodb";

import { setConfig } from "../../../../config/index.js";
import { addSchemas } from "../../../schema/index.schema.js";
import { setupWebhooksRoutes } from "../../../setup/setupWebhooksRoutes.js";

const cancelReservationRequest = vi.fn();
vi.mock("../../../../client/hostManager/index.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  cancelReservationRequest: (...a: unknown[]) => cancelReservationRequest(...a),
}));

const KEY_VALUE = "dm-key";
const TASK_ID = new ObjectId();
const KEY = TASK_ID.toHexString();
const HOLD = "2026-10-10T12:01:00.000Z";

const db = {
  tasks: { updateOne: vi.fn(), findOne: vi.fn() },
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
  setupWebhooksRoutes(server);
  await server.ready();
  return server;
}

const delivery = (over: Record<string, unknown> = {}) => ({
  deliveryId: "d-1",
  key: KEY,
  status: "fulfilled",
  requested: 2,
  nodes: [
    { nodeAddress: "n1", market: "m" },
    { nodeAddress: "n2", market: "m" },
  ],
  holdExpiresAt: HOLD,
  ...over,
});

describe("POST /webhooks/reservations", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    setConfig("host_manager_api_key", KEY_VALUE);
    db.tasks.updateOne.mockReset().mockResolvedValue({ matchedCount: 1 });
    db.tasks.findOne.mockReset().mockResolvedValue(null);
    cancelReservationRequest.mockReset().mockResolvedValue({ key: KEY, status: "cancelled", released: 2 });
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
    setConfig("host_manager_api_key", undefined);
  });

  const post = (raw: string, authorization?: string) =>
    server.inject({
      method: "POST",
      url: "/webhooks/reservations",
      headers: { "content-type": "application/json", ...(authorization !== undefined && { authorization }) },
      payload: raw,
    });

  const deliver = (body = delivery()) => post(JSON.stringify(body), KEY_VALUE);

  it("records the nodes on the task (the key is its id) waiting on its request, and makes it due now", async () => {
    const res = await deliver();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ accepted: true });
    expect(db.tasks.updateOne).toHaveBeenCalledExactlyOnceWith(
      { _id: TASK_ID, reservation_request: { $exists: true } },
      {
        $set: {
          reservation: {
            expiresAt: new Date(HOLD),
            nodes: [
              { node: "n1", market: "m" },
              { node: "n2", market: "m" },
            ],
          },
          due_at: expect.any(Date),
        },
        $unset: { reservation_request: "" },
      }
    );
    expect(cancelReservationRequest).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing key", undefined],
    ["another key", "other-key"],
    ["the key with extra characters", `${KEY_VALUE} `],
  ])("rejects %s with 401 and writes nothing", async (_case, authorization) => {
    const res = await post(JSON.stringify(delivery()), authorization);

    expect(res.statusCode).toBe(401);
    expect(db.tasks.updateOne).not.toHaveBeenCalled();
  });

  it("rejects everything while HOST_MANAGER_API_KEY is not configured", async () => {
    setConfig("host_manager_api_key", undefined);

    const res = await deliver();

    expect(res.statusCode).toBe(401);
    expect(db.tasks.updateOne).not.toHaveBeenCalled();
  });

  it("rejects an authenticated body that is not a fulfilment with 400", async () => {
    const res = await deliver(delivery({ nodes: undefined }));

    expect(res.statusCode).toBe(400);
    expect(db.tasks.updateOne).not.toHaveBeenCalled();
  });

  it("a redelivery of a reservation the task already holds is a 200 no-op", async () => {
    db.tasks.updateOne.mockResolvedValue({ matchedCount: 0 });
    db.tasks.findOne.mockResolvedValue({ _id: TASK_ID, reservation: { expiresAt: new Date(HOLD), nodes: [] } });

    const res = await deliver();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ accepted: true });
    expect(cancelReservationRequest).not.toHaveBeenCalled();
  });

  it("a task that exists but has no request (nor fill) releases the nodes and acknowledges", async () => {
    db.tasks.updateOne.mockResolvedValue({ matchedCount: 0 });
    db.tasks.findOne.mockResolvedValue({ _id: TASK_ID });

    const res = await deliver();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ accepted: false });
    expect(cancelReservationRequest).toHaveBeenCalledExactlyOnceWith(KEY);
  });

  it("a task that is gone (deployment stopped) answers 200 and releases the nodes", async () => {
    db.tasks.updateOne.mockResolvedValue({ matchedCount: 0 });

    const res = await deliver();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ accepted: false });
    expect(cancelReservationRequest).toHaveBeenCalledExactlyOnceWith(KEY);
  });

  it("a key that is not one of ours is released without touching any task", async () => {
    const res = await deliver(delivery({ key: "someone-else:7" }));

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ accepted: false });
    expect(db.tasks.updateOne).not.toHaveBeenCalled();
    expect(cancelReservationRequest).toHaveBeenCalledExactlyOnceWith("someone-else:7");
  });

  it("answers 500 when the write fails, so host-manager retries", async () => {
    db.tasks.updateOne.mockRejectedValue(new Error("mongo down"));

    const res = await deliver();

    expect(res.statusCode).toBe(500);
  });

  it("a release that fails never fails the webhook", async () => {
    db.tasks.updateOne.mockResolvedValue({ matchedCount: 0 });
    cancelReservationRequest.mockRejectedValue(new Error("host-manager down"));

    const res = await deliver();

    expect(res.statusCode).toBe(200);
  });
});
