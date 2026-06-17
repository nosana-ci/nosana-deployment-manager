import { Worker } from "worker_threads";

import { UnitOutcome } from "../transactions/index.js";
import { driveSend, persistSignedRecord } from "./unit.js";
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
            signature: "",
            lastValidBlockHeight: msg.lastValidBlockHeight,
            status: "SIGNED",
            blob: msg.blob,
            job: msg.job,
            run: msg.run,
          };
          outcomes.push(
            (async () => {
              await persistSignedRecord(ctx, record);
              return driveSend(ctx, record);
            })()
          );
        } else if (msg.event === "CONFIRMED") {
          outcomes.push(
            Promise.resolve(ctx.handlers.onConfirmed(msg.unit ?? 0, msg.tx, msg.job, msg.run)).then(
              () => ({ result: "CONFIRMED", signature: msg.tx })
            )
          );
        } else if (msg.event === "ERROR") {
          const error = msg.error ?? "unknown error";
          outcomes.push(
            Promise.resolve(ctx.handlers.onError(msg.unit ?? 0, error)).then(() => ({
              result: "ERROR",
              error,
            }))
          );
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
