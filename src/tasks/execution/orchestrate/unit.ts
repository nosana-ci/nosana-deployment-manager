import { sendUnit, UnitOutcome } from "../transactions/index.js";
import { OrchestrateResult, UnitContext } from "./types.js";
import { TxRecord } from "../../../types/index.js";

/** Patch one persisted unit's sub-document (matched by its `unit` index). */
export function markRecord(ctx: UnitContext, unit: number, fields: Partial<TxRecord>) {
  const set: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    set[`transactions.$[u].${key}`] = value;
  }
  return ctx.tasks.updateOne(
    { _id: ctx.taskId },
    { $set: set },
    { arrayFilters: [{ "u.unit": unit }] }
  );
}

/** Persist a freshly signed record BEFORE it is broadcast, so a crash mid-send is recoverable. */
export function persistSignedRecord(ctx: UnitContext, record: TxRecord) {
  return ctx.tasks.updateOne({ _id: ctx.taskId }, { $push: { transactions: record } });
}

/**
 * Record a unit's terminal outcome: update its persisted status and fire the
 * matching handler. Returns the outcome so callers can tally without tracking
 * mutable counters.
 */
export async function applyOutcome(
  ctx: UnitContext,
  record: TxRecord,
  outcome: UnitOutcome
): Promise<UnitOutcome> {
  switch (outcome.result) {
    case "CONFIRMED":
      await markRecord(ctx, record.unit, {
        status: "CONFIRMED",
        signature: outcome.signature,
        blob: null,
      });
      await ctx.handlers.onConfirmed(record.unit, outcome.signature, record.job, record.run);
      break;
    case "EXPIRED":
      await markRecord(ctx, record.unit, { status: "SENT", blob: null });
      break;
    case "ERROR":
      await markRecord(ctx, record.unit, { status: "SENT", blob: null });
      await ctx.handlers.onError(record.unit, outcome.error, outcome.signature);
      break;
    case "ABORTED":
      break;
  }
  return outcome;
}

/** Broadcast a fresh/resent record, then record its terminal outcome. */
export async function driveSend(ctx: UnitContext, record: TxRecord): Promise<UnitOutcome> {
  return applyOutcome(ctx, record, await sendUnit(record, ctx.signal));
}

/** Reduce per-unit outcomes into the orchestrate result. */
export function tally(outcomes: UnitOutcome[], aborted: boolean): OrchestrateResult {
  let confirmed = 0;
  let errored = 0;
  for (const outcome of outcomes) {
    if (outcome.result === "CONFIRMED") confirmed++;
    else if (outcome.result === "ERROR") errored++;
    else if (outcome.result === "ABORTED") aborted = true;
  }
  return { confirmed, errored, aborted };
}
