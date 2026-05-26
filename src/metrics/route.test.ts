import { describe, it, expect } from "vitest";
import fastify from "fastify";

import { createRegistry } from "./registry.js";
import { metricsRoute } from "./route.js";
import { httpFastifyPlugin } from "./http-fastify.js";
import { METRICS_ROUTE_PATH } from "./labels.js";

describe("metricsRoute", () => {
  it("responds with 200 on GET /metrics", async () => {
    const handle = createRegistry("api");
    const server = fastify({ logger: false });
    await server.register(metricsRoute(handle));

    const response = await server.inject({
      method: "GET",
      url: METRICS_ROUTE_PATH,
    });

    expect(response.statusCode).toBe(200);
    await server.close();
  });

  it("responds with the prometheus content-type", async () => {
    const handle = createRegistry("api");
    const server = fastify({ logger: false });
    await server.register(metricsRoute(handle));

    const response = await server.inject({
      method: "GET",
      url: METRICS_ROUTE_PATH,
    });

    expect(response.headers["content-type"]).toContain("text/plain");
    await server.close();
  });

  it("exposes metrics in the response body", async () => {
    const handle = createRegistry("api");
    const server = fastify({ logger: false });
    await server.register(metricsRoute(handle));

    const response = await server.inject({
      method: "GET",
      url: METRICS_ROUTE_PATH,
    });

    expect(response.body).toContain("process_cpu_user_seconds_total");
    await server.close();
  });

  it("does not increment http_requests_total for /metrics self-scrape", async () => {
    const handle = createRegistry("api");
    const server = fastify({ logger: false });
    await server.register(httpFastifyPlugin(handle));
    await server.register(metricsRoute(handle));

    // Hit /metrics
    await server.inject({ method: "GET", url: METRICS_ROUTE_PATH });
    // Scrape again to inspect state
    const response = await server.inject({
      method: "GET",
      url: METRICS_ROUTE_PATH,
    });

    expect(response.body).not.toContain(`route="${METRICS_ROUTE_PATH}"`);
    await server.close();
  });
});
