import { address } from "@solana/addresses";
import { parentPort, workerData } from "worker_threads";

import {
  prepareWorker,
  workerErrorFormatter,
  signTransactionToBlob,
} from "../../../worker/Worker.js";
import { runIdempotentCall, MAX_IDEMPOTENCY_EPOCH } from "../../idempotency/index.js";
import type { WorkerData } from "../../../types/index.js";

/**
 * EXTEND signer worker (single unit).
 *
 * Self-custody: build + sign the extend tx and emit SIGNED (parent sends).
 * API-key (unchanged): submit via the API and emit CONFIRMED.
 */
try {
  const { kit, useNosanaApiKey, task, taskId, startUnit = 0 } =
    await prepareWorker<WorkerData>(workerData);
  const {
    deployment: { timeout },
    job,
  } = task;

  if (!job) {
    throw new Error("No job specified for extension.");
  }

  try {
    if (useNosanaApiKey) {
      // Idempotent extend: the deterministic key de-duplicates a retried request
      // so a lost in-flight response can't double-extend (extra runtime/credits).
      const result = await runIdempotentCall({
        taskId,
        unit: startUnit,
        maxEpoch: MAX_IDEMPOTENCY_EPOCH,
        attempt: (idempotencyKey) =>
          kit.api!.jobs.extend({ address: job, seconds: timeout * 60 }, { idempotencyKey }),
      });

      if (result.kind === "ok") {
        if (result.value) {
          // A terminal job is a confirmed no-op with `tx: null` (the CM extends
          // nothing, charges nothing). Forward it as a tx-less CONFIRMED so the
          // cycle ends instead of erroring — onExtendConfirmed stops rescheduling
          // when there is no tx.
          parentPort!.postMessage({
            event: "CONFIRMED",
            unit: startUnit,
            job: result.value.job,
            tx: result.value.tx ?? undefined,
          });
        }
      } else if (result.kind === "retry") {
        parentPort!.postMessage({ event: "RETRY", unit: startUnit, retryAfterMs: result.retryAfterMs });
      } else {
        parentPort!.postMessage({ event: "ERROR", unit: startUnit, error: result.error });
      }
    } else {
      const instruction = await kit.jobs.extend({ job: address(job), timeout: timeout * 60 });
      const { blob, lastValidBlockHeight } = await signTransactionToBlob(kit, instruction);

      parentPort!.postMessage({
        event: "SIGNED",
        unit: startUnit,
        blob,
        lastValidBlockHeight,
        jobs: [job],
      });
    }
  } catch (error) {
    parentPort!.postMessage({ event: "ERROR", unit: startUnit, error: workerErrorFormatter(error) });
  }

  parentPort!.postMessage({ event: "DONE" });
} catch (error) {
  parentPort!.postMessage({ event: "ERROR", error: workerErrorFormatter(error) });
}
