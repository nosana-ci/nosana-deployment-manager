import path from "path";
import { fileURLToPath } from "url";
import { Db, Collection } from "mongodb";

import { getConfig } from "../../../config/index.js";

import { Worker } from "../Worker.js";
import { onListConfirmed, onListError, onListExit } from "./events/index.js";

import {
  DeploymentDocument,
  DeploymentStatus,
  EventDocument,
  JobsDocument,
  OutstandingTasksDocument,
  TaskDocument,
  VaultDocument,
  WorkerEventMessage,
} from "../../../types.js";

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
  complete: () => void,
): Worker {
  let errorType: DeploymentStatus;
  const setErrorType = (type: DeploymentStatus) => (errorType = type);

  const { network } = getConfig();
  const collections = {
    documents: db.collection<DeploymentDocument>("deployments"),
    events: db.collection<EventDocument>("events"),
    jobs: db.collection<JobsDocument>("jobs"),
    tasks: db.collection<TaskDocument>("tasks"),
  };

  const worker = new Worker("./list/worker.ts", {
    workerData: {
      task,
      network,
      vault: (task.deployment.vault as VaultDocument).vault_key,
    },
  });

  worker.on(
    "message",
    async ({ event, error, job, run, tx }: WorkerEventMessage) => {
      switch (event) {
        case "CONFIRMED":
          await onListConfirmed(tx, job, run, {
            task,
            collections,
            error: errorType,
            setErrorType,
          });
          break;
        case "ERROR":
          await onListError(tx, error, {
            task,
            collections,
            error: errorType,
            setErrorType,
          });
          break;
      }
    },
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
      db,
    );
    complete();
  });

  return worker;
}
