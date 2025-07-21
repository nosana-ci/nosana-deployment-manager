import { Db } from "mongodb";

import { getConfig } from "../../../config/index.js";
import { VAULT_PATH } from "../../../definitions/vault.js";

import { Worker } from "../Worker.js";
import { onStopConfirmed, onStopError, onStopExit } from "./events/index.js";

import {
  DeploymentDocument,
  DeploymentStatus,
  EventDocument,
  WorkerEventMessage,
  OutstandingTasksDocument,
  TaskDocument,
} from "../../../types";

export function spawnStopTask(
  db: Db,
  task: OutstandingTasksDocument,
  complete: () => void
): Worker {
  const { network } = getConfig();
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

  const worker = new Worker("./stop/worker.ts", {
    workerData: {
      task,
      network,
      vault: `${VAULT_PATH}${task.deployment.vault.toString()}.json`,
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
