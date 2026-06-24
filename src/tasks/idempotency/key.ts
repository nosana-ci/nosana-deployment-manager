/**
 * How many fresh epochs to walk within a single run when the CM reports the prior
 * key's signed tx provably dead (EXPIRED). Bounded so one degraded run can't
 * hammer the CM; exhaustion degrades to RETRY (the task reclaims).
 */
export const MAX_IDEMPOTENCY_EPOCH = 3;

/**
 * Deterministic idempotency key for an API-path job operation.
 *
 * The key is a pure function of durable, reclaim-stable identity:
 *   - `taskId`  — the task document `_id` (fixed for the life of the task),
 *   - `unit`    — the stable per-operation identifier *within* the task. For
 *                 LIST/EXTEND that is the replica slot index (0..target-1, stable
 *                 because `target_count` is fixed on the first attempt). For STOP
 *                 it is the job ADDRESS, because STOP's slot index is positional
 *                 over a job set that shrinks as jobs reach a terminal state — so
 *                 only the job address identifies the same logical stop on reclaim.
 *   - `epoch`   — bumped only when the Credit Manager reports the prior key's
 *                 signed tx provably dead (`IDEMPOTENCY_KEY_EXPIRED`), so a fresh
 *                 epoch maps to a fresh, safe-to-post transaction.
 *
 * Because every component is recomputable from the persisted task, a reclaim
 * after a crash regenerates the *same* key and the CM de-duplicates the retry —
 * so a lost in-flight response can never cause a second on-chain op. There is
 * nothing to durably store: the task is the store.
 */
export function buildIdempotencyKey(
  taskId: string,
  unit: string | number,
  epoch: number
): string {
  return `${taskId}:${unit}:${epoch}`;
}
