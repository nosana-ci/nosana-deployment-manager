import { JobState } from "@nosana/kit";
import { address } from "@solana/addresses";
import { parentPort, workerData } from "worker_threads";

import {
  prepareWorker,
  workerErrorFormatter,
  signTransactionToBlob,
} from "../../../worker/Worker.js";
import { runIdempotentBatch, MAX_IDEMPOTENCY_EPOCH } from "../../idempotency/index.js";
import type { WorkerData } from "../../../types/index.js";

/**
 * STOP signer worker, over the frozen `stopTargets` set (the jobs the task
 * committed to stopping on its first attempt — see stop/run.ts).
 *
 * API-key path: ONE stopBatch call settles the whole set under a single per-epoch
 * idempotency key (`taskId:stop:epoch`). The frozen set is the stable payload the
 * key requires; the CM replays its verdict on resend (so a job settles at most
 * once) and reports an already-settled job as a confirmed no-op (no tx). We emit
 * CONFIRMED only for job addresses without a CONFIRMED record yet, so each is
 * recorded once across reclaims.
 *
 * Self-custody path: per job, read on-chain state, build delist (QUEUED) / end
 * (RUNNING), sign, emit SIGNED — skipping jobs already terminal.
 */
const { kit, useNosanaApiKey, task, taskId, stopTargets = [] } =
  await prepareWorker<WorkerData>(workerData);

try {
  if (useNosanaApiKey) {
    const units = stopTargets.map((jobAddress, index) => ({
      id: index,
      body: { jobAddress },
    }));

    const result = await runIdempotentBatch({
      taskId,
      op: "stop",
      maxEpoch: MAX_IDEMPOTENCY_EPOCH,
      units,
      post: (jobs, idempotencyKey) => kit.api!.jobs.stopBatch({ jobs }, { idempotencyKey }),
    });

    // Dedupe by job address across reclaims: the walk re-collects every confirmed
    // job from epoch 0, so emit CONFIRMED only for jobs not already recorded.
    const recorded = new Set(
      (task.transactions ?? [])
        .filter((record) => record.status === "CONFIRMED")
        .flatMap((record) => record.jobs ?? [])
    );
    for (const confirmation of result.confirmed) {
      const jobAddress = confirmation.job ?? stopTargets[confirmation.id];
      if (recorded.has(jobAddress)) continue;
      parentPort!.postMessage({
        event: "CONFIRMED",
        unit: confirmation.id,
        job: jobAddress,
        tx: confirmation.tx,
      });
    }

    if (result.kind === "retry") {
      parentPort!.postMessage({ event: "RETRY", retryAfterMs: result.retryAfterMs });
    } else if (result.kind === "fatal") {
      parentPort!.postMessage({ event: "ERROR", error: result.error });
    }
  } else {
    await Promise.all(
      stopTargets.map(async (job, unit) => {
        try {
          const { state } = await kit.jobs.get(address(job));
          if ([JobState.COMPLETED, JobState.STOPPED].includes(state)) return;

          const instruction =
            state === JobState.QUEUED
              ? await kit.jobs.delist({ job: address(job) })
              : await kit.jobs.end({ job: address(job) });
          const { blob, lastValidBlockHeight } = await signTransactionToBlob(kit, instruction);

          parentPort!.postMessage({ event: "SIGNED", unit, blob, lastValidBlockHeight, jobs: [job] });
        } catch (error) {
          // Benign if the job is already settled: still terminal on-chain, or its
          // account has been closed (a delisted/ended job account gets cleaned up,
          // so the re-fetch throws "Account does not exist or has no data").
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
  }

  parentPort!.postMessage({ event: "DONE" });
} catch (error) {
  parentPort!.postMessage({ event: "ERROR", error: workerErrorFormatter(error) });
}
