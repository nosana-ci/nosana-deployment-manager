import type { Db } from "mongodb";

import { getConfig } from "../../../config/index.js";
import { VaultWorker } from "../../../worker/Worker.js";
import { getRepository } from "../../../repositories/index.js";
import { reconcileUnits, OrchestrateHandlers } from "../../execution/orchestrate/index.js";
import { onExtendConfirmed, onExtendError, onExtendExit } from "./events/index.js";

import {
  DeploymentStatus,
  OutstandingTasksDocument,
  TaskRunResult,
  WorkerData,
} from "../../../types/index.js";

export async function runExtendTask(
  db: Db,
  task: OutstandingTasksDocument,
  signal: AbortSignal
): Promise<TaskRunResult> {
  const tasks = getRepository("tasks").collection;
  const events = getRepository("events").collection;
  const deployments = getRepository("deployments").collection;

  let deploymentErrorStatus: DeploymentStatus | undefined;
  const handlers: OrchestrateHandlers = {
    onConfirmed: (_unit, signature, job) =>
      job ? onExtendConfirmed(events, task, db, signature, job) : undefined,
    onError: (_unit, error, signature) =>
      onExtendError(
        error,
        events,
        task,
        (status) => {
          deploymentErrorStatus = status;
        },
        signature
      ),
  };

  // EXTEND is a single unit (target = 1).
  const result = await reconcileUnits({
    tasks,
    taskId: task._id,
    existing: task.transactions ?? [],
    target: 1,
    signal,
    handlers,
    makeWorker: (count, startUnit) =>
      new VaultWorker<WorkerData>("../tasks/task/extend/worker.js", {
        workerData: {
          task,
          taskId: task._id.toHexString(),
          vault: task.deployment.vault.vault_key,
          confidential_ipfs_pin: getConfig().confidential_ipfs_pin,
          count,
          startUnit,
        },
      }),
  });
  if (result.aborted) return { outcome: "ABORTED", successCount: result.confirmed };
  if (result.retry) {
    return { outcome: "RETRY", successCount: result.confirmed, retryAfterMs: result.retryAfterMs };
  }

  await onExtendExit(deploymentErrorStatus, deployments, task);

  return {
    outcome: result.errored > 0 ? "FAILED" : "COMPLETED",
    successCount: result.confirmed,
  };
}
