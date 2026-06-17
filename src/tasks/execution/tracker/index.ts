import { getKit } from "../../../kit/index.js";
import { getConfig } from "../../../config/index.js";
import { fetchSignatureStatuses } from "./status.js";
import { evaluateEntries } from "./sweep.js";
import { Entry, TrackResult } from "./types.js";

export { classifySignatureStatus } from "./classify.js";
export { fetchSignatureStatuses } from "./status.js";
export type { TrackOutcome, TrackResult, SignatureStatusValue } from "./types.js";

/**
 * Process-wide confirmation tracker (singleton). Every broadcast signature
 * across every task shares ONE poll loop, so confirming N in-flight txs costs
 * roughly one `getBlockHeight` + ceil(N/256) `getSignatureStatuses` per cycle —
 * instead of N independent loops. The shared state (the in-flight `entries` map
 * and the sweep `timer`) lives here; the pure sub-modules
 * ({@link fetchSignatureStatuses}, {@link evaluateEntries}) receive it per call.
 */
const entries = new Map<string, Entry>();
let timer: NodeJS.Timeout | undefined;

function settle(signature: string, result: TrackResult): void {
  const entry = entries.get(signature);
  if (!entry) return;
  entries.delete(signature);
  entry.cleanup?.();
  entry.resolve(result);
  if (entries.size === 0) stopSweep();
}

async function sweep(): Promise<void> {
  if (entries.size === 0) {
    stopSweep();
    return;
  }

  const rpc = getKit().solana.rpc;

  let currentHeight: bigint;
  try {
    currentHeight = await rpc.getBlockHeight().send();
  } catch {
    // Transient RPC failure — leave entries in place and retry next cycle.
    // The lease-kill (abort) is the ultimate backstop if the RPC stays down.
    return;
  }

  const statusBySignature = await fetchSignatureStatuses([...entries.keys()]);
  for (const { signature, result } of evaluateEntries(entries, currentHeight, statusBySignature)) {
    settle(signature, result);
  }
}

function startSweep(): void {
  if (timer) return;
  const { task_confirm_poll_interval_ms } = getConfig();
  timer = setInterval(() => void sweep(), task_confirm_poll_interval_ms);
  // Don't keep the process alive solely for the tracker.
  timer.unref?.();
}

function stopSweep(): void {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}

/**
 * Wait for an already-broadcast signature to confirm or provably expire, via the
 * shared batched poller. Resolves ABORTED immediately if `signal` fires (e.g.
 * the lease was killed).
 */
export function trackSignature(
  signature: string,
  lastValidBlockHeight: number,
  signal?: AbortSignal
): Promise<TrackResult> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ outcome: "ABORTED" });
      return;
    }

    let cleanup: (() => void) | undefined;
    if (signal) {
      const onAbort = () => settle(signature, { outcome: "ABORTED" });
      signal.addEventListener("abort", onAbort, { once: true });
      cleanup = () => signal.removeEventListener("abort", onAbort);
    }

    entries.set(signature, { lastValidBlockHeight, resolve, cleanup });
    startSweep();
  });
}

/** Test helper: clear all tracker state. */
export function _resetTracker(): void {
  stopSweep();
  entries.clear();
}
