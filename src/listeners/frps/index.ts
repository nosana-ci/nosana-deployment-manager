import type { Db } from "mongodb";

import { getConfig } from "../../config/index.js";
import { getFrpsMetrics } from "../../metrics/frps.js";
import { createEventSource } from "../../client/eventSource/index.js";
import { frpsRegisterHandler, frpsUnregisterHandler } from "../../strategies/infinite/frps/index.js";

import { readCursor, createCursorWriter } from "./cursor.js";
import { runGapRecovery } from "./gapRecovery.js";
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
 * Resumes across restarts: the last processed event id is persisted, seeded back
 * as `Last-Event-ID`, and FRPS replays what was missed. When it can't (first
 * connect, a gap too large, or FRPS restarted), the `connected` event's `gap`
 * flag triggers a one-time snapshot re-baseline.
 */
export async function startFrpsListener(db: Db): Promise<FrpsListenerHandle> {
  const noop: FrpsListenerHandle = { stop: async () => {} };
  const {
    frps_watching_enabled,
    frps_internal_address,
    frps_internal_use_tls,
    frps_api_key,
    frps_cursor_throttle_ms,
  } = getConfig();

  if (!frps_watching_enabled) {
    console.log(`${LOG} disabled via FRPS_WATCHING_ENABLED, not subscribing`);
    return noop;
  }

  if (!frps_internal_address) {
    console.warn(`${LOG} FRPS_INTERNAL_ADDRESS is not set, not subscribing`);
    return noop;
  }

  const url = `${frps_internal_use_tls ? "https" : "http"}://${frps_internal_address}/api/conn/events`;
  const initialLastEventId = await readCursor();

  console.log(`${LOG} subscribing to ${url} (resume from ${initialLastEventId ?? "start"})`);

  const cursor = createCursorWriter(frps_cursor_throttle_ms);

  // Process events strictly in order. SSE delivers them ordered and the library
  // invokes our callbacks in order; this chain keeps their async DB work from
  // interleaving, so per-op status and the resume cursor stay consistent.
  let chain: Promise<void> = Promise.resolve();
  const enqueue = (task: () => Promise<void>) => {
    chain = chain.then(task).catch((error) => console.error(`${LOG} handler failed`, error));
  };

  const eventSource = createEventSource<FRPSEvents>({
    url,
    name: "FRPS listener",
    headers: frps_api_key ? { "X-API-Key": frps_api_key } : {},
    initialLastEventId,
    onConnectionChange: (connected) => getFrpsMetrics()?.setConnected(connected),
  });

  eventSource.on(FRPSEventTypes.CONNECTED, (event) => {
    if (event.gap) {
      console.warn(`${LOG} could not resume the event log, re-baselining from a snapshot`);
      enqueue(runGapRecovery);
    }
  });

  eventSource.on(FRPSEventTypes.REGISTERED, (event, lastEventId) => {
    getFrpsMetrics()?.recordEvent(FRPSEventTypes.REGISTERED);
    enqueue(async () => {
      await frpsRegisterHandler(event);
      cursor.record(lastEventId);
    });
  });

  eventSource.on(FRPSEventTypes.UNREGISTERED, (event, lastEventId) => {
    getFrpsMetrics()?.recordEvent(FRPSEventTypes.UNREGISTERED);
    enqueue(async () => {
      await frpsUnregisterHandler(event, db);
      cursor.record(lastEventId);
    });
  });

  return {
    stop: async () => {
      eventSource.close();
      getFrpsMetrics()?.setConnected(false);
      // Let in-flight handlers finish, then flush the latest cursor so a restart
      // resumes from where we actually stopped.
      await chain;
      await cursor.stop();
    },
  };
}
