import { classifySignatureStatus } from "./classify.js";
import { Entry, SignatureStatusValue, TrackResult } from "./types.js";

export type Settlement = { signature: string; result: TrackResult };

/**
 * Pure decision step of one sweep cycle: given the in-flight entries, the
 * current block height and the freshly fetched statuses, decide which signatures
 * have reached a terminal state. Status is checked BEFORE expiry, so a tx
 * confirmed at the boundary is never wrongly declared dead. No side effects —
 * the caller applies the returned settlements.
 */
export function evaluateEntries(
  entries: Map<string, Entry>,
  currentHeight: bigint,
  statusBySignature: Map<string, SignatureStatusValue>
): Settlement[] {
  const settlements: Settlement[] = [];
  for (const [signature, entry] of entries) {
    const { confirmed, error } = classifySignatureStatus(statusBySignature.get(signature));
    if (error) {
      settlements.push({ signature, result: { outcome: "ERROR", error } });
      continue;
    }
    if (confirmed) {
      settlements.push({ signature, result: { outcome: "CONFIRMED" } });
      continue;
    }
    if (currentHeight > BigInt(entry.lastValidBlockHeight)) {
      settlements.push({ signature, result: { outcome: "EXPIRED" } });
    }
  }
  return settlements;
}
