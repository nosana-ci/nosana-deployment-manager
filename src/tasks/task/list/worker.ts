import { address } from "@solana/addresses";
import { parentPort, workerData } from "worker_threads";

import {
  prepareWorker,
  workerErrorFormatter,
} from "../../../worker/Worker.js";
import { runIdempotentBatch, MAX_IDEMPOTENCY_EPOCH } from "../../idempotency/index.js";
import type { WorkerData } from "../../../types/index.js";

/**
 * LIST signer worker.
 *
 * Self-custody path: build one `assign` per node the parent reserved (each in
 * the node's own market), let the kit pack them into the fewest size/CU-bounded
 * transactions, and sign each — emitting one SIGNED message per packed bucket
 * (blob + lastValidBlockHeight + signature + the bucket's jobs/runs/nodes). It
 * does NOT broadcast — the parent persists each record then sends/confirms, so a
 * crash mid-send is recoverable.
 *
 * API-key path: ONE batch call has client-manager assign a job to every node of
 * the reservation, under a per-epoch idempotency key scoped to that reservation
 * (`taskId:assign-<reservationEpoch>:<epoch>`) carrying the whole hold — the
 * stable payload that key requires, since a reclaim within the hold reuses the
 * same reservation. A lost in-flight response retried on reclaim replays the
 * CM's frozen verdict, so a node that secretly got its job is never assigned
 * twice. {@link runIdempotentBatch} walks a fresh epoch over the expired tail;
 * we emit CONFIRMED only for nodes not yet on a TxRecord, so each job is
 * recorded exactly once across reclaims.
 */
try {
  const { kit, useNosanaApiKey, task, taskId, startUnit = 0, nodes = [], reservationEpoch } =
    await prepareWorker<WorkerData>(workerData);
  const { timeout } = task.deployment;

  // Resolved + frozen by the parent before the worker is spawned (see
  // resolveDefinitionHash.ts): the shared confidential placeholder pin for a
  // confidential deployment — its real definition is served to the node by the
  // job-definition route, never via an on-chain hash — or the active revision's
  // pin (SSH keys merged in) otherwise. This worker posts it blindly.
  const { ipfs_definition_hash } = workerData;
  if (!ipfs_definition_hash) {
    parentPort!.postMessage({ event: "ERROR", error: "Missing definition hash" });
    process.exit(1);
  }

  if (useNosanaApiKey) {
    if (reservationEpoch === undefined) {
      parentPort!.postMessage({ event: "ERROR", error: "Missing reservation epoch" });
      process.exit(1);
    }
    // The whole hold is sent every epoch-0 (the stable payload the key needs); the
    // expired tail is re-posted under fresh epochs against the same nodes, and once
    // the walk is exhausted the task reclaims and reserves afresh when the hold
    // lapses. We emit CONFIRMED only for nodes with no TxRecord yet — the walk
    // re-collects every confirmed node from epoch 0, so this keeps one record per
    // job across reclaims.
    const units = nodes.map((reserved) => ({
      id: reserved.node,
      body: {
        ipfsHash: ipfs_definition_hash,
        market: reserved.market,
        timeout: timeout * 60,
        node: reserved.node,
      },
    }));

    const result = await runIdempotentBatch({
      taskId,
      op: `assign-${reservationEpoch}`,
      maxEpoch: MAX_IDEMPOTENCY_EPOCH,
      units,
      post: (jobs, idempotencyKey) => kit.api!.jobs.assignBatch({ jobs }, { idempotencyKey }),
    });

    const marketOf = new Map(nodes.map((reserved) => [reserved.node, reserved.market]));
    const recorded = new Set((task.transactions ?? []).flatMap((record) => record.nodes ?? []));
    result.confirmed
      .filter((confirmation) => !recorded.has(confirmation.id)) // already recorded on a prior run
      .forEach((confirmation, index) => {
        parentPort!.postMessage({
          event: "CONFIRMED",
          unit: startUnit + index,
          job: confirmation.job,
          run: confirmation.run,
          tx: confirmation.tx,
          node: confirmation.id,
          market: marketOf.get(confirmation.id),
        });
      });

    if (result.kind === "retry") {
      parentPort!.postMessage({ event: "RETRY", retryAfterMs: result.retryAfterMs });
    } else if (result.kind === "fatal") {
      console.log("Error assigning jobs:", result.error);
      parentPort!.postMessage({ event: "ERROR", error: result.error });
    }
  } else {
    // Self-custody: one assign per reserved node, in that node's market, and let
    // the kit pack + sign them into the fewest txs (never sends). One SIGNED per
    // packed bucket; the parent persists each blob before broadcasting. signBatch
    // throws (no partial) on any build/sign failure, so the whole run errors → the
    // task reclaims and reuses the unused reserved nodes. computeUnitMargin
    // defaults to 3 (covers the market queue's 250-address cap); passed
    // explicitly to stay safe if the kit default shifts.
    const instructions = await kit.jobs.assignMany(
      nodes.map((reserved) => ({
        market: address(reserved.market),
        timeout: timeout * 60,
        ipfsHash: ipfs_definition_hash,
        node: address(reserved.node),
      }))
    );
    const signed = await kit.jobs.signBatch(instructions, { computeUnitMargin: 3 });

    const marketOf = new Map(nodes.map((reserved) => [reserved.node, reserved.market]));
    signed.forEach((tx, bucket) => {
      const bucketNodes = (tx.accounts.nodes ?? []).map(String);
      parentPort!.postMessage({
        event: "SIGNED",
        unit: startUnit + bucket,
        blob: tx.blob,
        lastValidBlockHeight: Number(tx.lastValidBlockHeight),
        signature: String(tx.signature),
        jobs: (tx.accounts.jobs ?? []).map(String),
        runs: (tx.accounts.runs ?? []).map(String),
        nodes: bucketNodes,
        markets: bucketNodes.map((node) => marketOf.get(node) ?? ""),
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
