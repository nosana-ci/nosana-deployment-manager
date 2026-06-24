import { address } from "@solana/addresses";
import { parentPort, workerData } from "worker_threads";

import {
  prepareWorker,
  workerErrorFormatter,
} from "../../../worker/Worker.js";
import { runIdempotentBatch, MAX_IDEMPOTENCY_EPOCH } from "../../idempotency/index.js";
import { pendingSlots } from "./pendingSlots.js";
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
 * API-key path: ONE batch call lists every replica slot server-side, under a
 * single per-epoch idempotency key (`taskId:list:epoch`) carrying the full target
 * set — the stable payload that key requires. A lost in-flight response retried on
 * reclaim replays the CM's frozen verdict, so a slot that secretly landed is never
 * listed twice. {@link runIdempotentBatch} walks a fresh epoch over the expired
 * tail; we emit CONFIRMED only for slots not yet recorded ({@link pendingSlots}),
 * so each slot is recorded exactly once across reclaims.
 */
try {
  const { kit, useNosanaApiKey, task, taskId, count = 0, startUnit = 0, target } =
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
    // The full target set is sent every epoch-0 (the stable payload the key needs);
    // the expired tail is re-posted under fresh epochs. We emit CONFIRMED only for
    // slots that have no CONFIRMED record yet — the walk re-collects every confirmed
    // slot from epoch 0, so this keeps one TxRecord per slot across reclaims.
    const slotCount = target ?? startUnit + count;
    const units = Array.from({ length: slotCount }, (_, slot) => ({
      id: slot,
      body: { ipfsHash: ipfs_definition_hash, market, timeout: timeout * 60 },
    }));

    const result = await runIdempotentBatch({
      taskId,
      op: "list",
      maxEpoch: MAX_IDEMPOTENCY_EPOCH,
      units,
      post: (jobs, idempotencyKey) => kit.api!.jobs.listBatch({ jobs }, { idempotencyKey }),
    });

    const pending = new Set(pendingSlots(task.transactions, slotCount));
    for (const confirmation of result.confirmed) {
      if (!pending.has(confirmation.id)) continue; // already recorded on a prior run
      parentPort!.postMessage({
        event: "CONFIRMED",
        unit: confirmation.id,
        job: confirmation.job,
        run: confirmation.run,
        tx: confirmation.tx,
      });
    }

    if (result.kind === "retry") {
      parentPort!.postMessage({ event: "RETRY", retryAfterMs: result.retryAfterMs });
    } else if (result.kind === "fatal") {
      console.log("Error listing jobs:", result.error);
      parentPort!.postMessage({ event: "ERROR", error: result.error });
    }
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
