import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";

import type { RegistryHandle } from "./registry.js";
import { METRICS_ROUTE_PATH } from "./labels.js";

/**
 * Fastify plugin that mounts a `GET /metrics` route returning the Prometheus
 * text exposition format from the given registry.
 *
 * The route excludes itself from HTTP metric instrumentation (handled in the
 * `httpFastifyPlugin` hook via the `METRICS_ROUTE_PATH` guard).
 *
 * Wrapped with `fastify-plugin` so it is visible at the root scope and
 * accessible from all encapsulated sub-contexts.
 */
export const metricsRoute = (handle: RegistryHandle): FastifyPluginAsync =>
  fp(async (server) => {
    server.get(
      METRICS_ROUTE_PATH,
      { logLevel: "silent", schema: { hide: true } },
      async (_req, reply) => {
        const metricsOutput = await handle.registry.metrics();
        reply.header("Content-Type", handle.registry.contentType);
        return metricsOutput;
      },
    );
  });
