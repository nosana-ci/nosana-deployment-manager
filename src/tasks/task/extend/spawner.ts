import { Db } from "mongodb";

import {
  onExtendConfirmed,
  onExtendError,
  onExtendExit,
} from "./events/index.js";
import { getConfig } from "../../../config/index.js";

import { VaultWorker } from "../../../worker/Worker.js";

import {
  DeploymentDocument,
  DeploymentStatus,
  EventDocument,
  WorkerEventMessage,
  OutstandingTasksDocument,
  VaultDocument,
  TaskFinishedReason,
  WorkerData,
} from "../../../types/index.js";

export function spawnExtendTask(
  db: Db,
  task: OutstandingTasksDocument,
  complete: (successCount: number, reason: TaskFinishedReason) => void
): VaultWorker<WorkerData> {
  const config = getConfig();
  const events = db.collection<EventDocument>("events");
  const deployments = db.collection<DeploymentDocument>("documents");

  let successCount = 0;
  let deploymentStatus: DeploymentStatus | undefined = undefined;

  const worker = new VaultWorker("./tasks/task/extend/worker.js", {
    workerData: {
      task,
      config,
      vault: (task.deployment.vault as VaultDocument).vault_key,
    },
  });

  worker.on("message", ({ event, error, tx }: WorkerEventMessage) => {
    switch (event) {
      case "CONFIRMED":
        successCount += 1;
        onExtendConfirmed(tx, events, task, db);
        break;
      case "ERROR":
        onExtendError(
          error,
          (status: DeploymentStatus) => (deploymentStatus = status),
          events,
          task
        );
        break;
    }
  });

  worker.on("exit", async () => {
    await onExtendExit(deploymentStatus, deployments, task);

    complete(successCount, deploymentStatus ? "FAILED" : "COMPLETED");
  });

  return worker;
}
