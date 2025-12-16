import { Db } from "mongodb";

import { getConfig } from "../../../config/index.js";

import { VaultWorker } from "../../../worker/Worker.js";
import { onStopConfirmed, onStopError, onStopExit } from "./events/index.js";

import {
  DeploymentDocument,
  DeploymentStatus,
  EventDocument,
  WorkerEventMessage,
  OutstandingTasksDocument,
  TaskDocument,
  VaultDocument,
  JobsCollection,
  TaskFinishedReason,
  WorkerData,
} from "../../../types/index.js";

export function spawnStopTask(
  db: Db,
  task: OutstandingTasksDocument,
  complete: (successCount: number, reason: TaskFinishedReason) => void
): VaultWorker<WorkerData> {
  const config = getConfig();
  const deploymentsCollection = db.collection<DeploymentDocument>("deployments");
  const jobsCollection = db.collection<JobsCollection>("jobs");
  const eventsCollection = db.collection<EventDocument>("events");
  const tasksCollection = db.collection<TaskDocument>("tasks");

  let successCount = 0;
  let deploymentErrorStatus: DeploymentStatus;

  tasksCollection.deleteMany({
    deploymentId: task.deploymentId,
    task: {
      $ne: "STOP",
    },
    ...(task.active_revision && { active_revision: { $ne: task.active_revision } }),
  });

  const worker = new VaultWorker("../tasks/task/stop/worker.js", {
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
        onStopConfirmed(tx, eventsCollection, task);
        break;
      case "ERROR":
        onStopError(
          tx,
          error,
          eventsCollection,
          task,
          (status: DeploymentStatus) => (deploymentErrorStatus = status)
        );
        break;
    }
  });

  worker.on("exit", async () => {
    if (!task.active_revision) {
      await onStopExit(deploymentErrorStatus, deploymentsCollection, jobsCollection, task);
    }
    complete(successCount, deploymentErrorStatus ? "FAILED" : "COMPLETED");
  });

  return worker;
}
