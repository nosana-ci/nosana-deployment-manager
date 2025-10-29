import path from "path";
import { fileURLToPath } from "url";
import { Db, Collection } from "mongodb";

import { Worker } from "../Worker.js";
import { onListConfirmed, onListError, onListExit } from "./events/index.js";

import {
  DeploymentDocument,
  DeploymentStatus,
  EventDocument,
  JobsDocument,
  OutstandingTasksDocument,
  TaskDocument,
  TaskFinishedReason,
  WorkerEventMessage,
} from "../../../types/index.js";
import { getConfig } from "../../../config/index.js";

export interface OnListEventParams {
  code?: number;
  error: DeploymentStatus;
  task: OutstandingTasksDocument;
  setErrorType: (type: DeploymentStatus) => void;
  collections: {
    events: Collection<EventDocument>;
    documents: Collection<DeploymentDocument>;
    jobs: Collection<JobsDocument>;
    tasks: Collection<TaskDocument>;
  };
}

export const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function spawnListTask(
  db: Db,
  task: OutstandingTasksDocument,
  complete: (successCount: number, reason: TaskFinishedReason) => void
): Worker {
  const collections = {
    documents: db.collection<DeploymentDocument>("deployments"),
    events: db.collection<EventDocument>("events"),
    jobs: db.collection<JobsDocument>("jobs"),
    tasks: db.collection<TaskDocument>("tasks"),
  };

  let successCount = 0;
  let errorType: DeploymentStatus;
  const setErrorType = (type: DeploymentStatus) => (errorType = type);

  const worker = new Worker("./list/worker.js", {
    workerData: {
      task,
      vault: task.deployment.vault.vault_key,
      confidential_ipfs_pin: getConfig().confidential_ipfs_pin
    },
  });

  worker.on(
    "message",
    ({ event, error, job, tx }: WorkerEventMessage) => {
      switch (event) {
        case "CONFIRMED":
          successCount += 1;
          onListConfirmed(tx, job, {
            task,
            collections,
            error: errorType,
            setErrorType,
          });
          break;
        case "ERROR":
          onListError(tx, error, {
            task,
            collections,
            error: errorType,
            setErrorType,
          });
          break;
      }
    }
  );

  worker.on("exit", async (code) => {
    await onListExit(
      {
        code,
        task,
        collections,
        error: errorType,
        setErrorType,
      },
      db
    );
    complete(successCount, errorType ? "FAILED" : "COMPLETED");
  });

  return worker;
}
