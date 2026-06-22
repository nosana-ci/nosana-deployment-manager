import { getConfig } from "../../../config/index.js";
import { VaultWorker } from "../../../worker/Worker.js";
import { getRepository } from "../../../repositories/index.js";
import { orchestrateUnits, OrchestrateHandlers } from "../../execution/orchestrate/index.js";
import { onStopConfirmed, onStopError, onStopExit } from "./events/index.js";

import type {
  DeploymentStatus,
  OutstandingTasksDocument,
  TaskRunResult,
  WorkerData,
} from "../../../types/index.js";

export async function runStopTask(
  task: OutstandingTasksDocument,
  signal: AbortSignal
): Promise<TaskRunResult> {
  const tasks = getRepository("tasks").collection;
  const jobsCollection = getRepository("jobs").collection;
  const deployments = getRepository("deployments").collection;
  const events = getRepository("events").collection;

  // Full-stop housekeeping: drop other pending tasks for this deployment so a
  // stop is not immediately undone by a queued LIST/EXTEND.
  if (!task.limit && !task.job) {
    await tasks.deleteMany({
      deploymentId: task.deploymentId,
      task: { $ne: "STOP" },
      ...(task.active_revision && { active_revision: { $ne: task.active_revision } }),
    });
  }

  const stoppedJobs: string[] = [];
  let deploymentErrorStatus: DeploymentStatus | undefined;

  const handlers: OrchestrateHandlers = {
    onConfirmed: (_unit, signature, job) => {
      if (job) {
        stoppedJobs.push(job);
        onStopConfirmed(job, signature, events, task);
      }
    },
    onError: (_unit, error, signature) =>
      onStopError(
        error,
        events,
        task,
        (status) => {
          deploymentErrorStatus = status;
        },
        signature
      ),
  };

  // STOP units are keyed to specific live jobs; the worker re-derives them and
  // skips already-stopped ones, so no resume/reconcile is needed.
  const worker = new VaultWorker<WorkerData>("../tasks/task/stop/worker.js", {
    workerData: {
      task,
      taskId: task._id.toHexString(),
      vault: task.deployment.vault.vault_key,
      confidential_ipfs_pin: getConfig().confidential_ipfs_pin,
    },
  });

  const result = await orchestrateUnits({
    tasks,
    taskId: task._id,
    existing: [],
    worker,
    signal,
    handlers,
  });
  if (result.aborted) return { outcome: "ABORTED", successCount: stoppedJobs.length };
  if (result.retry) {
    return { outcome: "RETRY", successCount: stoppedJobs.length, retryAfterMs: result.retryAfterMs };
  }

  await onStopExit(stoppedJobs, jobsCollection, task, deployments, deploymentErrorStatus);

  return {
    outcome: result.errored > 0 ? "FAILED" : "COMPLETED",
    successCount: stoppedJobs.length,
  };
}
