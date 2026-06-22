import type { TxRecord } from "../../../types/index.js";

/**
 * The replica slots an API-path LIST still needs to issue: every index in
 * `0..target-1` that does NOT yet have a CONFIRMED record.
 *
 * Computed as an explicit set difference, NOT `target - confirmed.length` with a
 * contiguous offset — so out-of-order partial success (e.g. slots 0, 2, 4 landed,
 * 1, 3, 5 pending) re-issues exactly {1, 3, 5} and never silently skips a gap.
 * Each slot maps to a stable `taskId:slot:epoch` idempotency key, so re-issuing a
 * slot that actually did confirm but wasn't recorded just replays the CM's cached
 * result — never a second job.
 */
export function pendingSlots(transactions: TxRecord[] | undefined, target: number): number[] {
  const confirmed = new Set(
    (transactions ?? []).filter((record) => record.status === "CONFIRMED").map((record) => record.unit)
  );
  const slots: number[] = [];
  for (let slot = 0; slot < target; slot++) {
    if (!confirmed.has(slot)) slots.push(slot);
  }
  return slots;
}
