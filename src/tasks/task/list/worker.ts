import { address } from "@solana/addresses";
import { parentPort, workerData } from "worker_threads";

import {
  prepareWorker,
  workerErrorFormatter,
  signTransactionToBlob,
} from "../../../worker/Worker.js";
import type { WorkerData } from "../../../types/index.js";

/**
 * LIST signer worker.
 *
 * Self-custody path: build + sign `count` job-creation transactions and emit one
 * SIGNED message per unit (blob + lastValidBlockHeight + job/run). It does NOT
 * broadcast — the parent persists each record then sends/confirms, so a crash
 * mid-send is recoverable.
 *
 * API-key path (unchanged): submit via the Nosana API and emit CONFIRMED/ERROR.
 *
 * `count` / `startUnit` are decided by the parent (reconciled against desired vs
 * already-confirmed), so this worker just produces exactly what it is told.
 */
try {
  const { kit, useNosanaApiKey, task, count = 0, startUnit = 0 } =
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

  await Promise.all(
    Array.from({ length: count }, async (_unused, index) => {
      const unit = startUnit + index;
      try {
        if (useNosanaApiKey) {
          const res = await kit.api!.jobs.list({
            ipfsHash: ipfs_definition_hash,
            timeout: timeout * 60,
            market,
          });
          parentPort!.postMessage({
            event: "CONFIRMED",
            unit,
            job: res.job,
            run: res.run,
            tx: res.tx,
          });
        } else {
          const instruction = await kit.jobs.post({
            ipfsHash: ipfs_definition_hash,
            timeout: timeout * 60,
            market: address(market),
          });
          const { blob, lastValidBlockHeight } = await signTransactionToBlob(kit, instruction);

          parentPort!.postMessage({
            event: "SIGNED",
            unit,
            blob,
            lastValidBlockHeight,
            job: instruction.accounts[0].address.toString(),
            run: instruction.accounts[2].address.toString(),
          });
        }
      } catch (error) {
        console.log("Error preparing job:", error);
        parentPort!.postMessage({
          event: "ERROR",
          unit,
          error: workerErrorFormatter(error),
        });
      }
    })
  );

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
