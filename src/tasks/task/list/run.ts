import { VaultWorker } from "../../../worker/Worker.js";
import { getConfig } from "../../../config/index.js";
import { getRepository } from "../../../repositories/index.js";
import { reconcileUnits, OrchestrateHandlers } from "../../execution/orchestrate/index.js";
import { onListConfirmed, onListError, onListExit } from "./events/index.js";
import {
  RetrySignal,
  applyRetryState,
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

  // Target is fixed on the first attempt so reclaim tops up rather than
  // re-deriving (which would shrink as this task's own jobs appear).
  let target = task.target_count;
  if (target == null) {
    target = computeListTarget(task);
    await tasks.updateOne({ _id: task._id }, { $set: { target_count: target } });
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
          confidential_ipfs_pin: getConfig().confidential_ipfs_pin,
          count,
          startUnit,
          target,
        },
      }),
  });
  if (result.aborted) return { outcome: "ABORTED", successCount: result.confirmed };
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
