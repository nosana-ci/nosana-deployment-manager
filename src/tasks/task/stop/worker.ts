import { JobState } from "@nosana/kit";
import { address } from "@solana/addresses";
import { parentPort, workerData } from "worker_threads";

import {
  prepareWorker,
  workerErrorFormatter,
  signTransactionToBlob,
} from "../../../worker/Worker.js";
import { selectJobsToStop } from "./selectJobsToStop.js";
import { runIdempotentCall, MAX_IDEMPOTENCY_EPOCH } from "../../idempotency/index.js";
import type { WorkerData } from "../../../types/index.js";

/**
 * STOP signer worker.
 *
 * One unit per job that still needs stopping. Idempotent across reclaims: jobs
 * already STOPPED/COMPLETED are skipped via an on-chain state check (and stopped
 * jobs also drop out of the enriched QUEUED/RUNNING set), so re-running never
 * re-stops a job.
 *
 * Self-custody: build delist (QUEUED) / end (RUNNING), sign, emit SIGNED.
 * API-key (unchanged): submit via the API and emit CONFIRMED.
 */
const { kit, useNosanaApiKey, task, taskId } = await prepareWorker<WorkerData>(workerData);

try {
  const jobs = selectJobsToStop(task.jobs, {
    limit: task.limit,
    activeRevision: task.active_revision,
  });

  await Promise.all(
    jobs.map(async ({ job }, unit) => {
      try {
        const { state } = await kit.jobs.get(address(job));
        if ([JobState.COMPLETED, JobState.STOPPED].includes(state)) return;

        if (useNosanaApiKey) {
          // Idempotent stop, keyed on the JOB ADDRESS (not the positional slot,
          // which is unstable as the job set shrinks across reclaims). De-dupes a
          // retried request so settlement runs at most once per stop.
          const result = await runIdempotentCall({
            taskId,
            unit: job,
            maxEpoch: MAX_IDEMPOTENCY_EPOCH,
            attempt: (idempotencyKey) => kit.api!.jobs.stop(job, { idempotencyKey }),
          });

          if (result.kind === "ok") {
            if (result.value) {
              parentPort!.postMessage({ event: "CONFIRMED", unit, job: result.value.job, tx: result.value.tx });
            }
            return;
          }
          if (result.kind === "retry") {
            parentPort!.postMessage({ event: "RETRY", unit, retryAfterMs: result.retryAfterMs });
            return;
          }
          // FATAL: route through the benign-terminal check below — a stop that
          // "failed" because the job is already settled must not surface as ERROR.
          throw new Error(result.error);
        }

        const instruction =
          state === JobState.QUEUED
            ? await kit.jobs.delist({ job: address(job) })
            : await kit.jobs.end({ job: address(job) });
        const { blob, lastValidBlockHeight } = await signTransactionToBlob(kit, instruction);

        parentPort!.postMessage({ event: "SIGNED", unit, blob, lastValidBlockHeight, jobs: [job] });
      } catch (error) {
        // The failure is benign if the job is already settled: either it still
        // reports a terminal on-chain state, or its account has been cleaned up
        // entirely (a delisted/ended job account gets closed, so the re-fetch
        // throws "Account does not exist or has no data").
        try {
          const { state } = await kit.jobs.get(address(job));
          if ([JobState.COMPLETED, JobState.STOPPED].includes(state)) return;
        } catch (lookupError) {
          if (
            lookupError instanceof Error &&
            lookupError.message === "Account does not exist or has no data"
          ) {
            return;
          }
        }
        parentPort!.postMessage({ event: "ERROR", unit, error: workerErrorFormatter(error) });
      }
    })
  );

  parentPort!.postMessage({ event: "DONE" });
} catch (error) {
  parentPort!.postMessage({ event: "ERROR", error: workerErrorFormatter(error) });
}
