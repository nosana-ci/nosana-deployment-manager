import { Db } from "mongodb";

import { getConfig } from "../../../config/index.js";

import { Worker } from "../Worker.js";
import { onStopConfirmed, onStopError, onStopExit } from "./events/index.js";

import {
  DeploymentDocument,
  DeploymentStatus,
  EventDocument,
  WorkerEventMessage,
  OutstandingTasksDocument,
  TaskDocument,
  VaultDocument,
} from "../../../types/index.js";

export function spawnStopTask(
  db: Db,
  task: OutstandingTasksDocument,
  complete: () => void
): Worker {
  const config = getConfig();
  const tasksCollection = db.collection<TaskDocument>("tasks");
  const eventsCollection = db.collection<EventDocument>("events");
  const deploymentsCollection =
    db.collection<DeploymentDocument>("deployments");

  let errorStatus: DeploymentStatus | undefined = undefined;

  tasksCollection.deleteMany({
    deploymentId: task.deploymentId,
    task: {
      $ne: "STOP",
    },
  });

  const worker = new Worker("./stop/worker.js", {
    workerData: {
      task,
      config,
      vault: (task.deployment.vault as VaultDocument).vault_key,
    },
  });

  worker.on("message", ({ event, error, tx }: WorkerEventMessage) => {
    switch (event) {
      case "CONFIRMED":
        onStopConfirmed(tx, eventsCollection, task);
        break;
      case "ERROR":
        onStopError(
          tx,
          error,
          eventsCollection,
          task,
          (type: DeploymentStatus) => (errorStatus = type)
        );
        break;
    }
  });

  worker.on("exit", async () => {
    await onStopExit(errorStatus, deploymentsCollection, task);
    complete();
  });

  return worker;
}
