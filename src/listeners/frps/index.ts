import type { Db } from "mongodb";

import { getConfig } from "../../config/index.js";
import { getFrpsMetrics } from "../../metrics/frps.js";
import { createEventSource } from "../../client/eventSource/index.js";
import { frpsRegisterHandler, frpsUnregisterHandler } from "../../strategies/infinite/frps/index.js";

import { FRPSEventTypes, type FRPSEvents } from "./types.js";

const LOG = "[FRPS listener]";

export type FrpsListenerHandle = { stop: () => Promise<void> };

/**
 * Subscribes to the FRPS connection event stream, the source of truth for
 * deployment tunnel health.
 *
 * Must run as a singleton — a second subscriber would double-schedule stops —
 * which it inherits from being started inside `startDeploymentManagerListeners`
 * (gated on `shouldRunListeners`).
 *
 * No resume cursor: on every (re)connect FRPS sends a snapshot of each proxy's
 * last couple of lifecycle events, so the current state is re-derived from
 * scratch. Missing intermediate events between connects changes nothing — only a
 * proxy's latest state (and whether it was ever up) drives a reaction, and the
 * snapshot always carries that.
 */
export async function startFrpsListener(db: Db): Promise<FrpsListenerHandle> {
  const noop: FrpsListenerHandle = { stop: async () => {} };
  const { frps_watching_enabled, frps_internal_address, frps_internal_use_tls, frps_api_key } =
    getConfig();

  if (!frps_watching_enabled) {
    console.log(`${LOG} disabled via FRPS_WATCHING_ENABLED, not subscribing`);
    return noop;
  }

  if (!frps_internal_address) {
    console.warn(`${LOG} FRPS_INTERNAL_ADDRESS is not set, not subscribing`);
    return noop;
  }

  const url = `${frps_internal_use_tls ? "https" : "http"}://${frps_internal_address}/api/conn/events`;
  console.log(`${LOG} subscribing to ${url}`);

  // Process events strictly in order. SSE delivers them ordered (the snapshot
  // first, then live) and the library invokes our callbacks in order; this chain
  // keeps their async DB work from interleaving, so per-op status stays
  // consistent. Handlers are idempotent, so a snapshot event that also arrives
  // live is harmless.
  let chain: Promise<void> = Promise.resolve();
  const enqueue = (task: () => Promise<void>) => {
    chain = chain.then(task).catch((error) => console.error(`${LOG} handler failed`, error));
  };

  const eventSource = createEventSource<FRPSEvents>({
    url,
    name: "FRPS listener",
    headers: frps_api_key ? { "X-API-Key": frps_api_key } : {},
    onConnectionChange: (connected) => getFrpsMetrics()?.setConnected(connected),
  });

  eventSource.on(FRPSEventTypes.REGISTERED, (event) => {
    getFrpsMetrics()?.recordEvent(FRPSEventTypes.REGISTERED);
    enqueue(() => frpsRegisterHandler(event));
  });

  eventSource.on(FRPSEventTypes.UNREGISTERED, (event) => {
    getFrpsMetrics()?.recordEvent(FRPSEventTypes.UNREGISTERED);
    enqueue(() => frpsUnregisterHandler(event, db));
  });

  return {
    stop: async () => {
      eventSource.close();
      getFrpsMetrics()?.setConnected(false);
      // Let in-flight handlers finish.
      await chain;
    },
  };
}
