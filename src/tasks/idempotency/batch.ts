import { classifyApiError } from "./classify.js";
import { buildIdempotencyKey } from "./key.js";
import { messageOf, retryAfterMsOf } from "./errorInfo.js";

/**
 * One unit to submit in a batch: a caller-supplied identity (`id`) plus the
 * endpoint request body. The id is opaque to the driver — for LIST it is the
 * replica slot, for STOP/EXTEND the job address — and is what a confirmation is
 * mapped back to so the caller can record/emit per unit.
 */
export type BatchUnit<Id, Body> = { id: Id; body: Body };

/** The per-item shape the driver reads from a resolved batch response. */
export type BatchResponseItem = {
  /** Index into the bodies array that was POSTed this epoch. */
  index: number;
  status: "confirmed" | "expired";
  /**
   * Confirming signature. Absent for a terminal no-op (an EXTEND/STOP of an
   * already-settled job did nothing on-chain) and for expired items.
   */
  tx?: string;
  job?: string;
  run?: string;
};

/** A confirmed unit, mapped back to its caller id, carried out of the walk. */
export type BatchConfirmation<Id> = {
  id: Id;
  tx?: string;
  job?: string;
  run?: string;
};

/**
 * Terminal outcome of a batch walk. `confirmed` is always the FULL set landed so
 * far (the walk re-collects it from epoch 0 each run), so a `retry`/`fatal` still
 * carries its partial confirmations for the caller to record + dedupe.
 *   - ok    — every unit resolved confirmed; nothing left expiring.
 *   - retry — in-flight / 5xx / network, or expired items remain (reclaim & re-walk).
 *   - fatal — a definitive client error (payload mismatch, out-of-credits, other 4xx).
 */
export type BatchResult<Id> =
  | { kind: "ok"; confirmed: BatchConfirmation<Id>[] }
  | { kind: "retry"; confirmed: BatchConfirmation<Id>[]; retryAfterMs?: number }
  | { kind: "fatal"; confirmed: BatchConfirmation<Id>[]; error: string };

/**
 * Drive a frozen set of units through the CM batch endpoints to a terminal
 * {@link BatchResult}, walking idempotency epochs over the *expired* tail.
 *
 * Contract (confirmed with the Credit Manager):
 *  - Each epoch posts under the deterministic key `taskId:op:epoch`. Epoch 0 sends
 *    the FULL frozen set; a given key must ALWAYS carry the same payload — resending
 *    it with a subset would be `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`. So a same-key
 *    resend is a pure server-side replay of that epoch's frozen verdict (no re-sign,
 *    no re-charge): confirmed stay confirmed (with their stored tx), expired stay
 *    expired. Same-key resend never re-attempts expired items.
 *  - To make progress on expired items we BUMP the epoch — a fresh key re-prepares
 *    fresh txs for *just those* items. Confirmed items are never carried into a later
 *    epoch's payload: a fresh key has no cross-key dedup, so re-including a landed
 *    LIST item would mint a SECOND job (and re-apply an EXTEND/STOP). This exclusion
 *    is the core safety rule.
 *  - A still-confirming batch throws `IDEMPOTENCY_KEY_IN_PROGRESS` → RETRY the SAME
 *    key after `Retry-After` (do NOT bump). The task reschedule re-walks from epoch
 *    0; resolved epochs replay from cache (a single indexed read, no chain I/O), so
 *    the only client state needed is which ids confirmed — recovered from the task's
 *    persisted records, never threaded in here.
 *  - Epoch exhaustion degrades to RETRY (reclaim) rather than failing the deployment.
 */
export async function runIdempotentBatch<Id, Body>(args: {
  taskId: string;
  /** Key namespace for this op — "list" | "stop" | "extend". */
  op: string;
  maxEpoch: number;
  /** The full frozen set; epoch 0's payload, and the identity map for every item. */
  units: BatchUnit<Id, Body>[];
  post: (bodies: Body[], idempotencyKey: string) => Promise<{ items: BatchResponseItem[] }>;
}): Promise<BatchResult<Id>> {
  const { taskId, op, maxEpoch, units, post } = args;
  const confirmed: BatchConfirmation<Id>[] = [];

  if (units.length === 0) return { kind: "ok", confirmed };

  let pending = units;
  for (let epoch = 0; epoch <= maxEpoch; epoch++) {
    const key = buildIdempotencyKey(taskId, op, epoch);

    let items: BatchResponseItem[];
    try {
      ({ items } = await post(
        pending.map((unit) => unit.body),
        key
      ));
    } catch (error) {
      // FATAL is the only non-retryable outcome. IN_PROGRESS / 5xx / network — and a
      // (spurious) thrown EXPIRED, which the batch never emits as a throw — all
      // reclaim the task and re-walk from epoch 0; confirmed-so-far is preserved.
      if (classifyApiError(error) === "FATAL") {
        return { kind: "fatal", confirmed, error: messageOf(error) };
      }
      return { kind: "retry", confirmed, retryAfterMs: retryAfterMsOf(error) };
    }

    const expired: BatchUnit<Id, Body>[] = [];
    for (const item of items) {
      const unit = pending[item.index];
      if (unit === undefined) continue; // defensive: ignore an out-of-range index
      if (item.status === "confirmed") {
        confirmed.push({ id: unit.id, tx: item.tx, job: item.job, run: item.run });
      } else {
        expired.push(unit);
      }
    }

    if (expired.length === 0) return { kind: "ok", confirmed };
    pending = expired; // bump: the next epoch's fresh key re-prepares just these
  }

  return { kind: "retry", confirmed };
}
