import { Db } from "mongodb";

import {
  onExtendConfirmed,
  onExtendError,
  onExtendExit,
} from "./events/index.js";
import { getConfig } from "../../../config/index.js";

import { Worker } from "../Worker.js";

import {
  DeploymentDocument,
  DeploymentStatus,
  EventDocument,
  WorkerEventMessage,
  OutstandingTasksDocument,
  VaultDocument,
} from "../../../types.js";

export function spawnExtendTask(
  db: Db,
  task: OutstandingTasksDocument,
  complete: () => void
): Worker {
  let errorStatus: DeploymentStatus | undefined = undefined;

  const config = getConfig();
  const events = db.collection<EventDocument>("events");
  const deployments = db.collection<DeploymentDocument>("documents");

  const worker = new Worker("./extend/worker.js", {
    workerData: {
      task,
      config,
      vault: (task.deployment.vault as VaultDocument).vault_key,
    },
  });

  worker.on("message", ({ event, error, tx }: WorkerEventMessage) => {
    switch (event) {
      case "CONFIRMED":
        onExtendConfirmed(tx, events, task);
        break;
      case "ERROR":
        onExtendError(
          error,
          (status: DeploymentStatus) => (errorStatus = status),
          events,
          task
        );
        break;
    }
  });

  worker.on("exit", async () => {
    await onExtendExit(errorStatus, deployments, task, db);

    complete();
  });

  return worker;
}
