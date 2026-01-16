import { Db } from "mongodb";

import { getConfig } from "../../../config/index.js";

import { VaultWorker } from "../../../worker/Worker.js";
import { onStopConfirmed, onStopError, onStopExit } from "./events/index.js";

import {
  DeploymentStatus,
  EventDocument,
  WorkerEventMessage,
  OutstandingTasksDocument,
  TaskDocument,
  VaultDocument,
  TaskFinishedReason,
  WorkerData,
  DeploymentDocument,
  JobsDocument,
} from "../../../types/index.js";

export function spawnStopTask(
  db: Db,
  task: OutstandingTasksDocument,
  complete: (successCount: number, reason: TaskFinishedReason) => void
): VaultWorker<WorkerData> {
  const config = getConfig();
  const jobsCollection = db.collection<JobsDocument>("jobs");
  const deploymentsCollection = db.collection<DeploymentDocument>("deployments");
  const eventsCollection = db.collection<EventDocument>("events");
  const tasksCollection = db.collection<TaskDocument>("tasks");

  let stoppedJobs: string[] = [];
  let newDeploymentStatus: DeploymentStatus | undefined = undefined;

  if (!task.limit && !task.job) {
    tasksCollection.deleteMany({
      deploymentId: task.deploymentId,
      task: {
        $ne: "STOP",
      },
      ...(task.active_revision && { active_revision: { $ne: task.active_revision } }),
    });
  }

  const worker = new VaultWorker("../tasks/task/stop/worker.js", {
    workerData: {
      task,
      config,
      vault: (task.deployment.vault as VaultDocument).vault_key,
    },
  });

  worker.on("message", ({ event, error, tx, job }: WorkerEventMessage) => {
    switch (event) {
      case "CONFIRMED":
        stoppedJobs.push(job);
        onStopConfirmed(job, tx, eventsCollection, task);
        break;
      case "ERROR":
        onStopError(
          tx,
          error,
          eventsCollection,
          task,
          (status: DeploymentStatus) => (newDeploymentStatus = status)
        );
        break;
    }
  });

  worker.on("exit", async () => {
    await onStopExit(stoppedJobs, jobsCollection, task, deploymentsCollection, newDeploymentStatus);
    complete(stoppedJobs.length, newDeploymentStatus ? "FAILED" : "COMPLETED");
  });

  return worker;
}
