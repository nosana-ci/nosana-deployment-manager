import type { Db } from "mongodb";

import { VaultWorker } from "../../../worker/Worker.js";
import { getRepository } from "../../../repositories/index.js";
import { reconcileUnits, OrchestrateHandlers } from "../../execution/orchestrate/index.js";
import { onListConfirmed, onListError, onListExit } from "./events/index.js";
import { resolveListDefinitionHash } from "./resolveDefinitionHash.js";
import {
  RetrySignal,
  applyRetryState,
  archiveBannedOwner,
  clearRetryState,
  retryDelayMs,
  shouldRetry,
} from "../retry/index.js";

import {
  DeploymentStrategy,
  OutstandingTasksDocument,
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
  const handlers: OrchestrateHandlers = {
    onConfirmed: (_unit, signature, job) =>
      job ? onListConfirmed(jobs, events, task, signature, job) : undefined,
    onError: (_unit, error, signature) =>
      onListError(
        events,
        task,
        error,
        (signal) => {
          retrySignal = signal;
        },
        signature
      ),
  };

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

  const result = await reconcileUnits({
    tasks,
    taskId: task._id,
    existing: task.transactions ?? [],
    target,
    signal,
    handlers,
    makeWorker: (count, startUnit) =>
      new VaultWorker<WorkerData>("../tasks/task/list/worker.js", {
        workerData: {
          task,
          taskId: task._id.toHexString(),
          vault: task.deployment.vault.vault_key,
          ipfs_definition_hash: ipfsDefinitionHash,
          count,
          startUnit,
          target,
        },
      }),
  });
  if (result.aborted) return { outcome: "ABORTED", successCount: result.confirmed };
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

  await onListExit(task);
  if ((task.inflight_retries ?? 0) > 0) await clearRetryState(deployments, task.deploymentId);

  return { outcome: "COMPLETED", successCount: result.confirmed };
}
