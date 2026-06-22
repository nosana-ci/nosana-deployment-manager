import { address } from "@solana/addresses";
import { parentPort, workerData } from "worker_threads";

import {
  prepareWorker,
  workerErrorFormatter,
} from "../../../worker/Worker.js";
import { runIdempotentCall, MAX_IDEMPOTENCY_EPOCH } from "../../idempotency/index.js";
import type { WorkerData } from "../../../types/index.js";

/**
 * LIST signer worker.
 *
 * Self-custody path: build `count` job-creation instructions, let the kit pack
 * them into the fewest size/CU-bounded transactions, and sign each — emitting one
 * SIGNED message per packed bucket (blob + lastValidBlockHeight + signature + the
 * bucket's jobs/runs). It does NOT broadcast — the parent persists each record
 * then sends/confirms, so a crash mid-send is recoverable.
 *
 * API-key path (unchanged): submit one job per API call and emit CONFIRMED/ERROR.
 *
 * `count` (jobs to create) / `startUnit` are decided by the parent (reconciled
 * against desired vs already-confirmed), so this worker produces exactly what it
 * is told and only packs how those jobs map onto txs.
 */
try {
  const { kit, useNosanaApiKey, task, taskId, count = 0, startUnit = 0 } =
    await prepareWorker<WorkerData>(workerData);
  const { active_revision, confidential, market, timeout } = task.deployment;

  let ipfs_definition_hash: string = workerData.confidential_ipfs_pin;

  if (!confidential) {
    const activeRevision = task.revisions.find(({ revision }) => revision === active_revision);

    if (!activeRevision) {
      parentPort!.postMessage({
        event: "ERROR",
        error: "Active revision not found",
      });
      process.exit(1);
    }

    ipfs_definition_hash = activeRevision.ipfs_definition_hash;
  }

  if (useNosanaApiKey) {
    // API-key path: one job per API call, posted+confirmed server-side. Each call
    // carries the deterministic `taskId:unit:epoch` idempotency key so a lost
    // in-flight response, retried on reclaim, is de-duplicated by the CM instead
    // of posting a second job. CONFIRMED on success; RETRY when in-flight / no
    // definitive response (reclaim, same key); ERROR only on a definitive failure.
    await Promise.all(
      Array.from({ length: count }, async (_unused, index) => {
        const unit = startUnit + index;
        const result = await runIdempotentCall({
          taskId,
          unit,
          maxEpoch: MAX_IDEMPOTENCY_EPOCH,
          attempt: (idempotencyKey) =>
            kit.api!.jobs.list(
              { ipfsHash: ipfs_definition_hash, timeout: timeout * 60, market },
              { idempotencyKey }
            ),
        });

        if (result.kind === "ok") {
          parentPort!.postMessage({
            event: "CONFIRMED",
            unit,
            job: result.value.job,
            run: result.value.run,
            tx: result.value.tx,
          });
        } else if (result.kind === "retry") {
          parentPort!.postMessage({ event: "RETRY", unit, retryAfterMs: result.retryAfterMs });
        } else {
          console.log("Error preparing job:", result.error);
          parentPort!.postMessage({ event: "ERROR", unit, error: result.error });
        }
      })
    );
  } else {
    // Self-custody: build `count` list instructions and let the kit pack + sign
    // them into the fewest txs (never sends). One SIGNED per packed bucket; the
    // parent persists each blob before broadcasting. signBatch throws (no partial)
    // on any build/sign failure, so the whole run errors → the task reclaims and
    // reconciles. computeUnitMargin defaults to 3 (covers the market queue's
    // 250-address cap); passed explicitly to stay safe if the kit default shifts.
    const instructions = await kit.jobs.listMany(
      { ipfsHash: ipfs_definition_hash, timeout: timeout * 60, market: address(market) },
      count
    );
    const signed = await kit.jobs.signBatch(instructions, { computeUnitMargin: 3 });

    signed.forEach((tx, bucket) => {
      parentPort!.postMessage({
        event: "SIGNED",
        unit: startUnit + bucket,
        blob: tx.blob,
        lastValidBlockHeight: Number(tx.lastValidBlockHeight),
        signature: String(tx.signature),
        jobs: (tx.accounts.jobs ?? []).map(String),
        runs: (tx.accounts.runs ?? []).map(String),
      });
    });
  }

  // Sentinel: the channel is FIFO, so receiving DONE means every unit message
  // above has already been delivered to the parent.
  parentPort!.postMessage({ event: "DONE" });
} catch (error) {
  console.log("Worker encountered an error:", error);
  parentPort!.postMessage({
    event: "ERROR",
    error: workerErrorFormatter(error),
  });
}
