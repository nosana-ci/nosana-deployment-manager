import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";

import type { RegistryHandle } from "./registry.js";
import { extractRoutePattern, statusRange, METRICS_ROUTE_PATH } from "./labels.js";

/**
 * Fastify plugin that records HTTP request metrics for every route except
 * `/metrics` (to avoid the scrape itself inflating counts).
 *
 * Uses `onRequest` to stamp the high-resolution start time on the request
 * object, and `onResponse` to compute duration and observe both
 * `http_requests_total` and `http_request_duration_seconds`.
 *
 * Prefers `req.routeOptions.url` (the templated path registered with Fastify)
 * over regex-based pattern extraction so that parameterised routes like
 * `/deployments/:id/jobs/:jobId` are used verbatim.
 *
 * Wrapped with `fastify-plugin` to skip encapsulation — hooks must be
 * registered at the root scope to apply to all routes on the server.
 */
export const httpFastifyPlugin = (handle: RegistryHandle): FastifyPluginAsync =>
  fp(async (server) => {
    server.addHook("onRequest", async (req) => {
      (req as { _metricsStart?: bigint })._metricsStart =
        process.hrtime.bigint();
    });

    server.addHook("onResponse", async (req, reply) => {
      const rawUrl = req.url.split("?")[0];
      if (rawUrl === METRICS_ROUTE_PATH) return;

      const route =
        (req.routeOptions?.url as string | undefined) ??
        extractRoutePattern(rawUrl);

      const startTime = (req as { _metricsStart?: bigint })._metricsStart;
      const durationSeconds = startTime
        ? Number(process.hrtime.bigint() - startTime) / 1e9
        : 0;

      handle.http.requestsTotal
        .labels(req.method, route, statusRange(reply.statusCode))
        .inc();
      handle.http.requestDuration.labels(req.method, route).observe(durationSeconds);
    });
  });
