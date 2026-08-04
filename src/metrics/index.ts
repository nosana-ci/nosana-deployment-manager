import { shouldRunApi, shouldRunListeners, shouldRunWorker } from "../config/mode.js";
import type { AppMode } from "../config/mode.js";

import { createRegistry } from "./registry.js";
import type { RegistryHandle } from "./registry.js";
import { httpFastifyPlugin } from "./http-fastify.js";
import { metricsRoute } from "./route.js";
import { makeWorkerMetrics } from "./worker.js";
import type { WorkerMetrics } from "./worker.js";
import { makeFrpsMetrics } from "./frps.js";
import type { FrpsMetrics } from "./frps.js";

export type { WorkerMetrics, FrpsMetrics };

export interface MetricsHandle {
  registry: RegistryHandle["registry"];
  mountRoute: ReturnType<typeof metricsRoute>;
  http?: { plugin: ReturnType<typeof httpFastifyPlugin> };
  worker?: WorkerMetrics;
  frps?: FrpsMetrics;
}

/**
 * Constructs the mode-aware metrics bundle for deployment-manager.
 *
 * - `api` mode: HTTP metrics plugin registered on the main Fastify server.
 * - `worker` mode: Worker task metrics; HTTP plugin registered on the health
 *   server so worker-only pods remain scrape-able.
 * - `all` mode: Both of the above.
 *
 * Always includes:
 * - Default Node.js / process metrics
 * - `GET /metrics` route plugin (`mountRoute`)
 */
export function createMetrics(mode: AppMode): MetricsHandle {
  const handle = createRegistry(mode);

  const metricsHandle: MetricsHandle = {
    registry: handle.registry,
    mountRoute: metricsRoute(handle),
  };

  if (shouldRunApi(mode)) {
    metricsHandle.http = { plugin: httpFastifyPlugin(handle) };
  }

  if (shouldRunWorker(mode)) {
    // In worker mode the HTTP plugin is mounted on the health server so the pod
    // is scrape-able; we still include it here for the `all` mode case where the
    // API server also exists.
    if (!metricsHandle.http) {
      metricsHandle.http = { plugin: httpFastifyPlugin(handle) };
    }
    metricsHandle.worker = makeWorkerMetrics(handle);
  }

  // The FRPS event stream only runs on the listeners side.
  if (shouldRunListeners(mode)) {
    metricsHandle.frps = makeFrpsMetrics(handle);
  }

  return metricsHandle;
}
