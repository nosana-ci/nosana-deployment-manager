import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import http from "node:http";
import fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";

import { streamDeploymentEventsHandler } from "./streamDeploymentEvents.js";
import { createDeploymentWatchers, type DeploymentStreamEvent } from "../../../../stream/deploymentWatchers.js";

const DEPLOYMENT = { id: "9X4SgG88q7La2UAxioNJKD9EfYEMtYpnuLHvzUvEGDEB", status: "STARTING", replicas: 1, active_revision: 1, endpoints: [] };
const ORIGIN = "https://dashboard.example";

/** A step the test releases by hand, standing in for a DB round-trip. */
const gate = () => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => { open = resolve; });
  return { open, opened };
};

/** Give the event loop time to deliver socket events. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

/**
 * The unit tests drive a mocked socket; these drive the real thing, with the
 * server built like production (default connection handling, CORS, the
 * preClose hook), so cleanup is checked against Node's actual semantics.
 */
describe("streamDeploymentEventsHandler over a real socket", () => {
  let server: FastifyInstance;
  let url: string;
  let watchers: ReturnType<typeof createDeploymentWatchers>;
  let middleware: ReturnType<typeof gate>;
  let jobs: ReturnType<typeof gate>;

  beforeEach(async () => {
    watchers = createDeploymentWatchers();
    middleware = gate();
    jobs = gate();
    const db = {
      jobs: { find: () => ({ sort: () => ({ toArray: () => jobs.opened.then(() => []) }) }) },
      tasks: { find: () => ({ sort: () => ({ toArray: async () => [] }) }) },
    };

    server = fastify({ logger: false });
    await server.register(cors, { origin: true });
    server.decorateReply("locals", {
      getter: () => ({ deployment: DEPLOYMENT, db, deploymentWatchers: watchers }),
    });
    server.addHook("preClose", async () => watchers.closeAll());
    server.get(
      "/stream",
      { preHandler: () => middleware.opened, exposeHeadRoute: false },
      streamDeploymentEventsHandler,
    );
    await server.listen({ port: 0, host: "127.0.0.1" });
    url = `http://127.0.0.1:${(server.server.address() as { port: number }).port}/stream`;
  });

  afterEach(async () => {
    if (server.server.listening) await server.close();
  });

  /**
   * One plain socket per request (`agent: false`): Node's fetch would keep a
   * spare pooled connection open after an abort, which has nothing to do with
   * the stream but would hold the server's graceful close.
   */
  const connect = (headers: http.OutgoingHttpHeaders = {}, method = "GET") => {
    const request = http.request(url, { method, headers, agent: false });
    const response = new Promise<http.IncomingMessage>((resolve, reject) => {
      request.on("response", (res) => { res.setEncoding("utf8"); resolve(res); });
      request.on("error", reject);
    });
    // Tests abort on purpose; the failed request is expected.
    response.catch(() => {});
    request.end();
    return { response, abort: () => request.destroy() };
  };

  const watching = () => watchers.count(DEPLOYMENT.id);

  /** Resolve once the stream has delivered the given text. */
  const readUntil = (res: http.IncomingMessage, needle: string) =>
    new Promise<void>((resolve, reject) => {
      let received = "";
      res.on("data", (chunk: string) => {
        received += chunk;
        if (received.includes(needle)) resolve();
      });
      res.once("end", () => reject(new Error(`stream ended before delivering ${needle}`)));
    });

  const BASELINE = '"type":"deployment"';

  it("carries the CORS headers plugins set onto the stream", async () => {
    middleware.open();
    jobs.open();
    const res = await connect({ origin: ORIGIN }).response;

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream");
    expect(res.headers["access-control-allow-origin"]).toBe(ORIGIN);
  });

  it("does not expose a HEAD route, which would hijack and never answer", async () => {
    middleware.open();
    jobs.open();

    const res = await connect({}, "HEAD").response;

    expect(res.statusCode).toBe(404);
  });

  it("unwatches when the client aborts after receiving the baseline", async () => {
    middleware.open();
    jobs.open();
    const { response, abort } = connect();
    await readUntil(await response, BASELINE);
    expect(watching()).toBe(1);

    abort();

    await vi.waitFor(() => expect(watching()).toBe(0));
  });

  it("leaves no watcher when the client aborts while the jobs load", async () => {
    middleware.open();
    const { abort } = connect();
    await settle();
    expect(watching()).toBe(0);

    abort();
    await settle();
    jobs.open();
    await settle();

    expect(watching()).toBe(0);
  });

  it("leaves no watcher when the client aborts before the handler runs", async () => {
    jobs.open();
    const { abort } = connect();
    await settle();

    abort();
    await settle();
    middleware.open();
    await settle();

    expect(watching()).toBe(0);
  });

  it("keeps a second connection to the same deployment when the first aborts", async () => {
    middleware.open();
    jobs.open();
    const first = connect();
    const second = connect();
    await readUntil(await first.response, BASELINE);
    const secondRes = await second.response;
    await readUntil(secondRes, BASELINE);
    expect(watching()).toBe(2);

    first.abort();
    await vi.waitFor(() => expect(watching()).toBe(1));

    // The survivor still receives what the change listener delivers.
    const event: DeploymentStreamEvent = { type: "deployment", status: "RUNNING", replicas: 1, active_revision: 1 };
    const delivered = readUntil(secondRes, JSON.stringify(event));
    watchers.notify(DEPLOYMENT.id, event);
    await delivered;

    second.abort();
    await vi.waitFor(() => expect(watching()).toBe(0));
  });

  it("ends open streams so the server can shut down while clients are connected", async () => {
    middleware.open();
    jobs.open();
    const res = await connect().response;
    await readUntil(res, BASELINE);
    expect(watching()).toBe(1);
    const ended = new Promise<void>((resolve) => res.once("end", resolve));

    // Without the preClose hook this waits until the client leaves, which it never does.
    await server.close();

    expect(watching()).toBe(0);
    await ended;
  });
});
