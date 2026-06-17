import { getKit } from "../../../kit/index.js";
import { classifySignatureStatus, fetchSignatureStatuses } from "../tracker/index.js";
import { RecoveryAction } from "./types.js";
import { TxRecord } from "../../../types/index.js";

/**
 * Decide what each resumed record needs, using ONE shared block height and ONE
 * batched status read for the whole cohort — instead of per-unit RPC. Keyed by
 * `unit`. Mirrors the tracker's ordering (status before expiry) so a tx
 * confirmed at the boundary is never declared dead.
 *
 *   - confirmed                 -> OUTCOME CONFIRMED (never re-sent)
 *   - landed but reverted (err) -> OUTCOME ERROR
 *   - no blob to (re)send       -> OUTCOME EXPIRED (caller rebuilds)
 *   - past lastValidBlockHeight  -> OUTCOME EXPIRED (provably dead, safe rebuild)
 *   - in-window, not yet seen    -> RESEND the identical blob, then track
 *
 * A getBlockHeight failure propagates (the caller abandons the task for reclaim),
 * matching the conservative "don't guess expiry" stance. A missing status (not
 * found, or a failed status batch) is read as pending -> RESEND, never a false
 * CONFIRMED/ERROR.
 */
export async function recoverUnits(records: TxRecord[]): Promise<Map<number, RecoveryAction>> {
  const actions = new Map<number, RecoveryAction>();
  if (records.length === 0) return actions;

  const rpc = getKit().solana.rpc;

  const signatures = records.map((record) => record.signature).filter((sig): sig is string => !!sig);
  const [currentHeight, statusBySignature] = await Promise.all([
    rpc.getBlockHeight().send(),
    fetchSignatureStatuses(signatures),
  ]);

  for (const record of records) {
    if (record.signature) {
      const { confirmed, error } = classifySignatureStatus(statusBySignature.get(record.signature));
      if (confirmed) {
        actions.set(record.unit, {
          kind: "OUTCOME",
          outcome: { result: "CONFIRMED", signature: record.signature },
        });
        continue;
      }
      if (error) {
        actions.set(record.unit, {
          kind: "OUTCOME",
          outcome: { result: "ERROR", signature: record.signature, error },
        });
        continue;
      }
    }

    // Not confirmed and not reverted: resend if we still can, else rebuild.
    if (!record.blob || currentHeight > BigInt(record.lastValidBlockHeight)) {
      actions.set(record.unit, {
        kind: "OUTCOME",
        outcome: { result: "EXPIRED", signature: record.signature || undefined },
      });
      continue;
    }
    actions.set(record.unit, { kind: "RESEND" });
  }

  return actions;
}
