import {
  Registry,
  collectDefaultMetrics,
  Counter,
  Histogram,
} from "prom-client";

export const SERVICE_NAME = "deployment-manager";

export interface HttpMetrics {
  requestsTotal: Counter<"method" | "route" | "status_range">;
  requestDuration: Histogram<"method" | "route">;
}

export interface RegistryHandle {
  registry: Registry;
  http: HttpMetrics;
}

/**
 * Creates a fresh, isolated Prometheus registry with:
 * - Constant labels: `service` and `app_mode`
 * - Default Node.js / process metrics
 * - `http_requests_total` counter
 * - `http_request_duration_seconds` histogram
 *
 * Always constructs a new `Registry` instance — never touches the prom-client
 * default singleton — to prevent cross-test contamination.
 */
export function createRegistry(appMode: string): RegistryHandle {
  const registry = new Registry();
  registry.setDefaultLabels({ service: SERVICE_NAME, app_mode: appMode });
  collectDefaultMetrics({ register: registry });

  const requestsTotal = new Counter({
    name: "http_requests_total",
    help: "Total HTTP requests",
    labelNames: ["method", "route", "status_range"] as const,
    registers: [registry],
  });

  const requestDuration = new Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request duration in seconds",
    labelNames: ["method", "route"] as const,
    // Widened from dashboard-backend's [0.1, 0.5, 1, 2.5, 5, 10] so that
    // sub-100 ms responses are not all collapsed into the first bucket.
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });

  return { registry, http: { requestsTotal, requestDuration } };
}
