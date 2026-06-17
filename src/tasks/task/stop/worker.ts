import { JobState } from "@nosana/kit";
import { address } from "@solana/addresses";
import { parentPort, workerData } from "worker_threads";

import {
  prepareWorker,
  workerErrorFormatter,
  signTransactionToBlob,
} from "../../../worker/Worker.js";
import { selectJobsToStop } from "./selectJobsToStop.js";
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
const { kit, useNosanaApiKey, task } = await prepareWorker<WorkerData>(workerData);

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
          const res = await kit.api!.jobs.stop(job);
          if (res) {
            parentPort!.postMessage({ event: "CONFIRMED", unit, job: res.job, tx: res.tx });
          }
          return;
        }

        const instruction =
          state === JobState.QUEUED
            ? await kit.jobs.delist({ job: address(job) })
            : await kit.jobs.end({ job: address(job) });
        const { blob, lastValidBlockHeight } = await signTransactionToBlob(kit, instruction);

        parentPort!.postMessage({ event: "SIGNED", unit, blob, lastValidBlockHeight, job });
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
