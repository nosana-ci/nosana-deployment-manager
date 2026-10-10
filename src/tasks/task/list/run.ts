import type { Db } from "mongodb";

import { VaultWorker } from "../../../worker/Worker.js";
import { decryptWithKey } from "../../../vault/decrypt.js";
import { getRepository } from "../../../repositories/index.js";
import { reconcileUnits, OrchestrateHandlers } from "../../execution/orchestrate/index.js";
import { scheduleTask } from "../../scheduleTask.js";
import { retryCooldownMs } from "../../utils/cooldown.js";
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
  TaskType,
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

  const spawnWorker = (nodes: ReservedNode[], startUnit: number) =>
    new VaultWorker<WorkerData>("../tasks/task/list/worker.js", {
      workerData: {
        task,
        taskId: task._id.toHexString(),
        vault: task.deployment.vault.vault_key,
        ipfs_definition_hash: ipfsDefinitionHash,
        count: nodes.length,
        startUnit,
        nodes,
      },
    });

  // Reserve the shortfall left after resuming prior records, and persist it
  // (inside reserveListNodes) before the worker posts anything. A request
  // host-manager has to queue parks the task; fewer nodes than jobs assigns
  // what was reserved and hands the rest to a new LIST task (see below).
  let reserved: ReserveOutcome | undefined;
  const reserveAndSpawn = async (count: number, startUnit: number) => {
    const outcome = await reserveListNodes(tasks, events, task, count, signal);
    reserved = outcome;
    if (outcome.kind !== "reserved") return null;
    // Self-custody signs one assign per unused node. The API-key path posts the
    // whole hold under the task's assign key: a same-key resend must carry the
    // same payload, and the worker skips the nodes already recorded.
    return useNosanaApiKey
      ? spawnWorker(outcome.reservation.nodes, startUnit)
      : spawnWorker(outcome.nodes, startUnit);
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
  if (reserved?.kind === "fatal") {
    await failListDeployment(events, deployments, task, reserved.error);
    return { outcome: "FAILED", successCount: result.confirmed };
  }
  // 503 / no response: retry the same key after the cooldown.
  if (reserved?.kind === "retry") onListError(events, task, reserved.error, setRetrySignal);
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
  if (shouldRetry(result, retrySignal)) {
    const delayMs = retryDelayMs(task, result, retrySignal);
    await applyRetryState(deployments, task.deploymentId, retrySignal, delayMs);
    return { outcome: "RETRY", successCount: result.confirmed, retryAfterMs: delayMs };
  }
  // No capacity yet is not an error: host-manager holds the request and calls
  // the webhook when nodes appear (which makes the task due at once). Park until
  // the request needs renewing, without the error backoff or the retry caps, so
  // the deployment stays RUNNING however long the market stays empty.
  if (reserved?.kind === "waiting") return { outcome: "PARKED", successCount: result.confirmed };
  // This task's one request is spent: whatever is still missing goes to a new
  // LIST task with a request of its own, at the back of host-manager's queue.
  const missing = target - result.confirmed;
  if (missing > 0 && (reserved?.kind === "handoff" || reserved?.kind === "reserved")) {
    await handOffShortfall(db, events, task, missing, reserved.kind === "handoff" && reserved.backoff);
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

/**
 * Hand what this LIST still misses to a new LIST task, carrying what scopes the
 * work: the job an INFINITE rotation replaces (so it is dropped with that job)
 * and the revision (so a revision swap sweeps it). Created once per task
 * (`handoff_of`), however often this one is reclaimed, and after the retry
 * cooldown when this task got no node at all, so a chain of lapsed or expired
 * requests cannot spin.
 */
async function handOffShortfall(
  db: Db,
  events: EventsCollection,
  task: OutstandingTasksDocument,
  missing: number,
  backoff: boolean
) {
  const due = new Date(Date.now() + (backoff ? retryCooldownMs(0, false) : 0));
  const created = await scheduleTask(db, TaskType.LIST, task.deploymentId, task.deployment.status, due, {
    limit: missing,
    job: task.job,
    active_revision: task.active_revision,
    handoff_of: task._id,
  });
  if (!created) return;
  await events.insertOne({
    deploymentId: task.deploymentId,
    category: "Deployment",
    type: "JOB_RESERVE_SHORTFALL",
    message: `${missing} job(s) still need a node: requested again by a new LIST task`,
    created_at: new Date(),
  });
}
