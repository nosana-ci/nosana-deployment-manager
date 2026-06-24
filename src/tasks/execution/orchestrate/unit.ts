import { sendUnit, UnitOutcome } from "../transactions/index.js";
import { OrchestrateResult, UnitContext } from "./types.js";
import { recordJobs, recordRuns } from "./record.js";
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
 * Persist an API-path unit's CONFIRMED record AFTER its bookkeeping handler has
 * run, so a reclaim skips re-issuing that slot. Pushed post-handler (not before)
 * so the slot is only marked skippable once its job is durably recorded — a crash
 * in between just leaves the slot un-recorded, to be re-issued (and CM-deduped).
 */
export function persistConfirmedRecord(ctx: UnitContext, record: TxRecord) {
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
    case "CONFIRMED": {
      await markRecord(ctx, record.unit, {
        status: "CONFIRMED",
        signature: outcome.signature,
        blob: null,
      });
      // A bulked tx confirms atomically, so every job it packed is now created;
      // fan the per-job bookkeeping out so the handlers stay single-job.
      const jobs = recordJobs(record);
      const runs = recordRuns(record);
      for (let i = 0; i < jobs.length; i++) {
        await ctx.handlers.onConfirmed(record.unit, outcome.signature, jobs[i], runs[i]);
      }
      return { ...outcome, jobCount: jobs.length };
    }
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
  let retry = false;
  let retryAfterMs: number | undefined;
  for (const outcome of outcomes) {
    // `confirmed` counts JOBS, not units: a bulked unit confirms N jobs at once.
    if (outcome.result === "CONFIRMED") confirmed += outcome.jobCount ?? 1;
    else if (outcome.result === "ERROR") errored++;
    else if (outcome.result === "ABORTED") aborted = true;
    // RETRY (API-key in-flight) leaves the run non-terminal like ABORTED, but is a
    // legitimate wait, not a crash — surfaced separately so the consumer reschedules
    // it without burning the crash-loop budget. Wait the LONGEST hint so a re-run
    // doesn't fire before every in-flight unit is plausibly ready.
    else if (outcome.result === "RETRY") {
      retry = true;
      if (outcome.retryAfterMs != null) {
        retryAfterMs = Math.max(retryAfterMs ?? 0, outcome.retryAfterMs);
      }
    }
  }
  return { confirmed, errored, aborted, retry, retryAfterMs };
}
