import type { Db } from "mongodb";

import { VaultWorker } from "../../../worker/Worker.js";
import { decryptWithKey } from "../../../vault/decrypt.js";
import { getRepository } from "../../../repositories/index.js";
import { reconcileUnits, OrchestrateHandlers } from "../../execution/orchestrate/index.js";
import { onListConfirmed, onListError, onListExit } from "./events/index.js";
import { resolveListDefinitionHash } from "./resolveDefinitionHash.js";
import { reserveListNodes, type ReserveOutcome } from "./reserve.js";
import {
  RetrySignal,
  applyRetryState,
  archiveBannedOwner,
  clearRetryState,
  retryDelayMs,
  shouldRetry,
} from "../retry/index.js";

import {
  DeploymentCollection,
  DeploymentStatus,
  DeploymentStrategy,
  EventsCollection,
  OutstandingTasksDocument,
  ReservedNode,
  TaskRunResult,
  WorkerData,
} from "../../../types/index.js";

/** How many jobs this LIST task should ultimately create (fixed on attempt 1). */
function computeListTarget(task: OutstandingTasksDocument): number {
  if (task.limit != null) return task.limit;
  const { replicas, strategy } = task.deployment;
  if (strategy === DeploymentStrategy.SIMPLE || strategy === DeploymentStrategy["SIMPLE-EXTEND"]) {
    return Math.max(0, replicas - task.jobs.length);
  }
  return replicas;
}

export async function runListTask(
  db: Db,
  task: OutstandingTasksDocument,
  signal: AbortSignal
): Promise<TaskRunResult> {
  const tasks = getRepository("tasks").collection;
  const jobs = getRepository("jobs").collection;
  const events = getRepository("events").collection;
  const deployments = getRepository("deployments").collection;

  let retrySignal: RetrySignal | undefined;
  const setRetrySignal = (signal: RetrySignal) => {
    retrySignal = signal;
  };
  const handlers: OrchestrateHandlers = {
    onConfirmed: (_unit, signature, job, _run, reserved) =>
      job ? onListConfirmed(jobs, events, task, signature, job, reserved) : undefined,
    onError: (_unit, error, signature) => onListError(events, task, error, setRetrySignal, signature),
  };

  // Both vault types post by assigning reserved nodes: self-custody signs the
  // assigns itself, an API-key vault has client-manager assign them (one key
  // decrypt here: the worker decrypts again to sign).
  const useNosanaApiKey = decryptWithKey(task.deployment.vault.vault_key).startsWith("nos_");

  // Target and definition hash are frozen together on the first attempt so a
  // reclaim tops up the same plan instead of re-deriving it: the target would
  // shrink as this task's own jobs appear, and the hash — which embeds the
  // deployment's SSH keys when set — must stay identical for the API batch
  // path's idempotency key. A throw here (nothing is signed yet) propagates to
  // the consumer's catch-all, which abandons the task for reclaim.
  let target = task.target_count;
  let ipfsDefinitionHash = task.ipfs_definition_hash;
  if (target == null || ipfsDefinitionHash == null) {
    target ??= computeListTarget(task);
    ipfsDefinitionHash ??= resolveListDefinitionHash(task);
    await tasks.updateOne(
      { _id: task._id },
      { $set: { target_count: target, ipfs_definition_hash: ipfsDefinitionHash } }
    );
  }

  const spawnWorker = (nodes: ReservedNode[], startUnit: number, reservationEpoch?: number) =>
    new VaultWorker<WorkerData>("../tasks/task/list/worker.js", {
      workerData: {
        task,
        taskId: task._id.toHexString(),
        vault: task.deployment.vault.vault_key,
        ipfs_definition_hash: ipfsDefinitionHash,
        count: nodes.length,
        startUnit,
        nodes,
        reservationEpoch,
      },
    });

  // Reserve the shortfall left after resuming prior records, and persist it
  // (inside reserveListNodes) before the worker posts anything. Fewer nodes than
  // jobs assigns what was reserved and waits out the cooldown for the rest, as
  // does no node at all.
  let reserveFailure: Exclude<ReserveOutcome, { kind: "reserved" }> | undefined;
  const reserveAndSpawn = async (count: number, startUnit: number) => {
    const reserved = await reserveListNodes(tasks, events, task, count, signal);
    if (reserved.kind !== "reserved") {
      reserveFailure = reserved;
      return null;
    }
    if (reserved.nodes.length < count) retrySignal ??= { insufficientFunds: false };
    if (reserved.nodes.length === 0) return null;
    // Self-custody signs one assign per unused node. The API-key path posts the
    // whole hold under a key scoped to its epoch: a same-key resend must carry
    // the same payload, and the worker skips the nodes already recorded.
    return useNosanaApiKey
      ? spawnWorker(reserved.reservation.nodes, startUnit, reserved.reservation.epoch)
      : spawnWorker(reserved.nodes, startUnit);
  };

  const result = await reconcileUnits({
    tasks,
    taskId: task._id,
    existing: task.transactions ?? [],
    target,
    signal,
    handlers,
    makeWorker: reserveAndSpawn,
  });
  if (result.aborted) return { outcome: "ABORTED", successCount: result.confirmed };
  // 422 / 404 from host-manager: the deployment's market or requirements can
  // never be reserved, so retrying cannot help.
  if (reserveFailure?.kind === "fatal") {
    await failListDeployment(events, deployments, task, reserveFailure.error);
    return { outcome: "FAILED", successCount: result.confirmed };
  }
  // 503 / no response: retry the same key after the cooldown.
  if (reserveFailure?.kind === "retry") onListError(events, task, reserveFailure.error, setRetrySignal);
  // A negative CM balance means this owner's credits were clawed back for foul
  // play — condemn the whole account (archive every deployment, delist their jobs)
  // rather than retry. Owner-wide, not just this deployment.
  if (retrySignal?.negativeBalance) {
    await archiveBannedOwner(db, task.deployment.owner);
    return { outcome: "FAILED", successCount: result.confirmed };
  }
  // A handled error (or an in-flight wait) reschedules the task with an escalating
  // cooldown instead of flipping the deployment to terminal ERROR — it stays
  // RUNNING while it retries. The errored unit re-signs via reconcile top-up.
  // 409 (same key in flight) is an in-flight wait, like a CM IN_PROGRESS.
  const inFlight = result.retry || reserveFailure?.kind === "in-progress";
  if (shouldRetry({ ...result, retry: inFlight }, retrySignal)) {
    const delayMs = retryDelayMs(task, result, retrySignal);
    await applyRetryState(deployments, task.deploymentId, retrySignal, delayMs);
    return { outcome: "RETRY", successCount: result.confirmed, retryAfterMs: delayMs };
  }

  await onListExit(task);
  if ((task.inflight_retries ?? 0) > 0) await clearRetryState(deployments, task.deploymentId);

  return { outcome: "COMPLETED", successCount: result.confirmed };
}

/** A LIST that can never succeed as configured: surface why and flag the deployment ERROR. */
async function failListDeployment(
  events: EventsCollection,
  deployments: DeploymentCollection,
  task: OutstandingTasksDocument,
  error: string
) {
  await events.insertOne({
    deploymentId: task.deploymentId,
    category: "Deployment",
    type: "JOB_LIST_ERROR",
    message: error,
    created_at: new Date(),
  });
  await deployments.updateOne(
    { id: task.deploymentId, status: { $ne: DeploymentStatus.ARCHIVED } },
    { $set: { status: DeploymentStatus.ERROR } }
  );
}
