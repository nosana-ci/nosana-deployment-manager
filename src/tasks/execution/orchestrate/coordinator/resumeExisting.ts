import { applyOutcome, driveSend } from "../unit.js";
import { recordJobs } from "../record.js";
import { recoverUnits, type UnitOutcome } from "../../transactions/index.js";

import type { UnitContext } from "../types.js";
import type { TxRecord } from "../../../../types/index.js";

/**
 * Resume prior-attempt records via one BATCHED recovery pre-check
 * ({@link recoverUnits}: a single getBlockHeight + batched getSignatureStatuses
 * for the whole cohort). Already-confirmed units are never re-sent; the rest are
 * either re-broadcast (in-window) or marked expired for the caller to rebuild.
 */
export async function resumeExisting(ctx: UnitContext, existing: TxRecord[]): Promise<UnitOutcome[]> {
  const confirmedOutcomes: UnitOutcome[] = [];
  const toRecover: TxRecord[] = [];

  for (const record of existing) {
    if (record.status === "CONFIRMED") {
      confirmedOutcomes.push({
        result: "CONFIRMED",
        signature: record.signature,
        jobCount: recordJobs(record).length,
      });
    } else {
      toRecover.push(record);
    }
  }

  if (ctx.signal.aborted || toRecover.length === 0) return confirmedOutcomes;

  const actions = await recoverUnits(toRecover);
  const recovered = await Promise.all(
    toRecover.map((record) => {
      const action = actions.get(record.unit);
      return action?.kind === "RESEND"
        ? driveSend(ctx, record)
        : applyOutcome(ctx, record, action?.outcome ?? { result: "EXPIRED" });
    })
  );

  return [...confirmedOutcomes, ...recovered];
}
