import { describe, it, expect } from "vitest";
import fastify from "fastify";

import { createRegistry } from "./registry.js";
import { httpFastifyPlugin } from "./http-fastify.js";
import { METRICS_ROUTE_PATH } from "./labels.js";

describe("httpFastifyPlugin", () => {
  it("records http_requests_total after a GET request", async () => {
    const handle = createRegistry("api");
    const server = fastify({ logger: false });
    await server.register(httpFastifyPlugin(handle));
    server.get("/jobs/:id", async () => "ok");

    await server.inject({ method: "GET", url: "/jobs/42" });

    const output = await handle.registry.metrics();
    expect(output).toContain('http_requests_total');
    expect(output).toContain('method="GET"');
    expect(output).toContain('route="/jobs/:id"');
    expect(output).toContain('status_range="2xx"');
    await server.close();
  });

  it("records http_request_duration_seconds after a request", async () => {
    const handle = createRegistry("api");
    const server = fastify({ logger: false });
    await server.register(httpFastifyPlugin(handle));
    server.get("/health", async () => "ok");

    await server.inject({ method: "GET", url: "/health" });

    const output = await handle.registry.metrics();
    expect(output).toContain("http_request_duration_seconds");
    await server.close();
  });

  it("uses the templated route from routeOptions.url, not the literal URL", async () => {
    const handle = createRegistry("api");
    const server = fastify({ logger: false });
    await server.register(httpFastifyPlugin(handle));
    server.get("/deployments/:deploymentId/jobs/:jobId", async () => "ok");

    await server.inject({
      method: "GET",
      url: "/deployments/abc123/jobs/def456",
    });

    const output = await handle.registry.metrics();
    expect(output).toContain('route="/deployments/:deploymentId/jobs/:jobId"');
    await server.close();
  });

  it("records 4xx status range for a 404 response", async () => {
    const handle = createRegistry("api");
    const server = fastify({ logger: false });
    await server.register(httpFastifyPlugin(handle));
    // No routes registered — all requests will 404

    await server.inject({ method: "GET", url: "/not-found" });

    const output = await handle.registry.metrics();
    expect(output).toContain('status_range="4xx"');
    await server.close();
  });

  it(`does not increment http_requests_total for ${METRICS_ROUTE_PATH} requests`, async () => {
    const handle = createRegistry("api");
    const server = fastify({ logger: false });
    await server.register(httpFastifyPlugin(handle));
    server.get(METRICS_ROUTE_PATH, async (_req, reply) => {
      reply.header("Content-Type", handle.registry.contentType);
      return handle.registry.metrics();
    });

    await server.inject({ method: "GET", url: METRICS_ROUTE_PATH });

    const output = await handle.registry.metrics();
    // http_requests_total should not have an observation for /metrics itself
    expect(output).not.toContain(`route="${METRICS_ROUTE_PATH}"`);
    await server.close();
  });

  it("records a POST request with its method label", async () => {
    const handle = createRegistry("api");
    const server = fastify({ logger: false });
    await server.register(httpFastifyPlugin(handle));
    server.post("/jobs", async () => ({ id: 1 }));

    await server.inject({ method: "POST", url: "/jobs", payload: {} });

    const output = await handle.registry.metrics();
    expect(output).toContain('method="POST"');
    await server.close();
  });
});
