import { Counter, Gauge } from "prom-client";

import type { RegistryHandle } from "./registry.js";
import { FRPSEventTypes } from "../listeners/frps/types.js";

/**
 * What a tunnel-loss signal resulted in. `stale_event` covers a graceful
 * teardown (an op finishing), an FRPS too old to send a reason, or an frpc that
 * had already reconnected by the time we checked.
 */
export const FRPS_OUTCOMES = [
  "scheduled",
  "cancelled",
  "skipped",
  "stale_event",
] as const;
export type FrpsOutcome = (typeof FRPS_OUTCOMES)[number];

export interface FrpsMetrics {
  setConnected(connected: boolean): void;
  recordEvent(type: FRPSEventTypes): void;
  recordOutcome(outcome: FrpsOutcome): void;
}

/**
 * Creates and registers the FRPS tunnel-watching metrics.
 *
 * Metrics registered:
 * - `frps_stream_connected` gauge (0/1) — alert on this. A stream that dies
 *   without the pod noticing is the main failure mode of this subsystem.
 * - `frps_events_total{type}` counter
 * - `frps_unhealthy_jobs_total{outcome}` counter
 */
export function makeFrpsMetrics(handle: RegistryHandle): FrpsMetrics {
  const streamConnected = new Gauge({
    name: "frps_stream_connected",
    help: "Whether the FRPS event stream is currently connected (1) or not (0)",
    registers: [handle.registry],
  });
  streamConnected.set(0);

  const eventsTotal = new Counter({
    name: "frps_events_total",
    help: "Total FRPS connection events received, by type",
    labelNames: ["type"] as const,
    registers: [handle.registry],
  });

  const unhealthyJobsTotal = new Counter({
    name: "frps_unhealthy_jobs_total",
    help: "FRPS tunnel-loss signals, by what the handler did with them",
    labelNames: ["outcome"] as const,
    registers: [handle.registry],
  });

  return {
    setConnected: (connected) => streamConnected.set(connected ? 1 : 0),
    recordEvent: (type) => eventsTotal.labels(type).inc(),
    recordOutcome: (outcome) => unhealthyJobsTotal.labels(outcome).inc(),
  };
}

let frpsMetricsHandle: FrpsMetrics | null = null;

/**
 * Registers the metrics handle for the FRPS handlers to drive. Mirrors
 * `registerWorkerMetrics` in `src/stats/index.ts`: nullable, so handlers and
 * their tests work without a registry.
 */
export function registerFrpsMetrics(handle: FrpsMetrics): void {
  frpsMetricsHandle = handle;
}

export function getFrpsMetrics(): FrpsMetrics | null {
  return frpsMetricsHandle;
}
