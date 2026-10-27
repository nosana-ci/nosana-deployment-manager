import type { TxRecord } from "../../../types/index.js";

/**
 * The replica slots an API-path LIST has NOT yet recorded as CONFIRMED: every
 * index in `0..target-1` without a CONFIRMED record.
 *
 * The batch worker always sends the full target set, so this is no longer a
 * "what to send" list — it's the dedupe filter for which confirmations to (re)emit.
 * runIdempotentBatch re-collects every confirmed slot from epoch 0 each run, so a
 * slot is emitted (and recorded) only while it is still in this set, keeping one
 * TxRecord per slot across reclaims.
 *
 * Computed as an explicit set difference, NOT `target - confirmed.length` with a
 * contiguous offset — so out-of-order partial success (e.g. slots 0, 2, 4 landed,
 * 1, 3, 5 pending) yields exactly {1, 3, 5} and never silently skips a gap.
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
