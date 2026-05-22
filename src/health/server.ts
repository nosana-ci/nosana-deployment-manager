import fastify, { FastifyInstance } from "fastify";

import { getConfig } from "../config/index.js";
import { getStats } from "../stats/index.js";
import { AppMode } from "../config/mode.js";
import type { MetricsHandle } from "../metrics/index.js";

/**
 * Tiny HTTP server used by the `worker` mode (and only the `worker` mode) to
 * expose `/health` for the Kubernetes liveness probe, `/stats` for ad-hoc
 * ops debugging, and `/metrics` for Prometheus scraping. The full Fastify API
 * runs under `api` mode and already exposes all three endpoints on the same port.
 */
export async function startHealthServer(mode: AppMode, metricsHandle: MetricsHandle): Promise<FastifyInstance> {
  const server = fastify({ logger: true });

  // Register metrics instrumentation and the /metrics scrape endpoint so that
  // worker-only pods are scrape-able on the same port as /health.
  if (metricsHandle.http) {
    await server.register(metricsHandle.http.plugin);
  }
  await server.register(metricsHandle.mountRoute);

  server.get("/", { logLevel: "silent" }, (_req, res) => res.status(200).send());

  server.get("/health", { logLevel: "silent" }, (_req, res) =>
    res.status(200).send({
      status: "healthy",
      mode,
      timestamp: new Date().toISOString(),
    }),
  );

  server.get("/stats", { logLevel: "silent" }, (_req, res) => {
    const stats = getStats();
    res.status(200).send({
      ...stats,
      running_ms: new Date().getTime() - stats.started_at.getTime(),
      started_at: stats.started_at.toISOString(),
    });
  });

  await server.listen({
    host: "0.0.0.0",
    port: getConfig().deployment_manager_port,
  });

  return server;
}
