import { Worker } from "worker_threads";

import { UnitOutcome } from "../transactions/index.js";
import { driveSend, persistSignedRecord, persistConfirmedRecord } from "./unit.js";
import { UnitContext } from "./types.js";
import { TxRecord, WorkerMessage } from "../../../types/index.js";

/**
 * Consume a signer worker's message stream and drive each emitted unit to a
 * terminal {@link UnitOutcome}:
 *  - SIGNED            -> persist the record BEFORE broadcasting it, then send.
 *  - CONFIRMED / ERROR -> API-key path: the worker already submitted, so just
 *                         run bookkeeping and report the outcome.
 *
 * The returned promise resolves once the worker signals DONE (FIFO: all unit
 * messages already delivered), exits, errors, or the run is aborted — and only
 * after every in-flight unit has settled. The worker thread is always
 * terminated: the kit holds keep-alive RPC sockets that would otherwise keep the
 * thread (and its full heap) resident for minutes.
 */
export async function runWorkerMessages(ctx: UnitContext, worker: Worker): Promise<UnitOutcome[]> {
  const outcomes: Promise<UnitOutcome>[] = [];
  let onAbort: () => void = () => {};

  try {
    await new Promise<void>((resolve) => {
      onAbort = resolve;
      if (ctx.signal.aborted) return resolve();
      ctx.signal.addEventListener("abort", onAbort, { once: true });

      worker.on("message", (msg: WorkerMessage) => {
        if (msg.event === "SIGNED") {
          const record: TxRecord = {
            unit: msg.unit,
            // signBatch yields the signature up front; persist it so recovery can
            // status-check even if we crash between persist and broadcast.
            signature: msg.signature ?? "",
            lastValidBlockHeight: msg.lastValidBlockHeight,
            status: "SIGNED",
            blob: msg.blob,
            jobs: msg.jobs,
            runs: msg.runs,
          };
          outcomes.push(
            (async () => {
              await persistSignedRecord(ctx, record);
              return driveSend(ctx, record);
            })()
          );
        } else if (msg.event === "CONFIRMED") {
          // API-key path (self-custody never emits CONFIRMED). Record the job
          // FIRST, then persist the slot's CONFIRMED record so a reclaim skips
          // re-issuing it — ordering keeps "slot recorded" ⊆ "job recorded".
          const unit = msg.unit ?? 0;
          // A terminal no-op confirmation carries no tx (nothing was sent on-chain);
          // record it as "" so the slot still counts as done and is never re-issued.
          const signature = msg.tx ?? "";
          const record: TxRecord = {
            unit,
            signature,
            lastValidBlockHeight: 0,
            status: "CONFIRMED",
            jobs: msg.job ? [msg.job] : [],
            runs: msg.run ? [msg.run] : [],
          };
          outcomes.push(
            (async () => {
              await ctx.handlers.onConfirmed(unit, signature, msg.job, msg.run);
              await persistConfirmedRecord(ctx, record);
              return { result: "CONFIRMED", signature };
            })()
          );
        } else if (msg.event === "ERROR") {
          const error = msg.error ?? "unknown error";
          outcomes.push(
            Promise.resolve(ctx.handlers.onError(msg.unit ?? 0, error)).then(() => ({
              result: "ERROR",
              error,
            }))
          );
        } else if (msg.event === "RETRY") {
          // In-flight / no definitive response: no bookkeeping, no failure flag.
          // The RETRY outcome makes the run non-terminal so the task is rescheduled
          // (not counted as a crash) and re-issues the same idempotency key.
          outcomes.push(Promise.resolve({ result: "RETRY", retryAfterMs: msg.retryAfterMs }));
        } else if (msg.event === "DONE") {
          resolve();
        }
      });

      worker.on("error", (error) => {
        outcomes.push(
          Promise.resolve(ctx.handlers.onError(0, String(error))).then(() => ({
            result: "ERROR",
            error: String(error),
          }))
        );
        resolve();
      });
      worker.on("exit", () => resolve());
    });
  } finally {
    ctx.signal.removeEventListener("abort", onAbort);
    await worker.terminate().catch(() => {});
  }

  return Promise.all(outcomes);
}
