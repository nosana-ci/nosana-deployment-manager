import path from "path";
import { fileURLToPath } from "url";
import { Db, Collection } from "mongodb";

import { VaultWorker } from "../../../worker/Worker.js";
import { onListConfirmed, onListError, onListExit } from "./events/index.js";

import {
  DeploymentDocument,
  DeploymentStatus,
  EventDocument,
  JobsDocument,
  OutstandingTasksDocument,
  TaskDocument,
  TaskFinishedReason,
  WorkerData,
  WorkerEventMessage,
} from "../../../types/index.js";
import { getConfig } from "../../../config/index.js";

export interface OnListEventParams {
  code?: number;
  task: OutstandingTasksDocument;
  setDeploymentErrorStatus: (type: DeploymentStatus) => void;
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
): VaultWorker<WorkerData> {
  const collections = {
    documents: db.collection<DeploymentDocument>("deployments"),
    events: db.collection<EventDocument>("events"),
    jobs: db.collection<JobsDocument>("jobs"),
    tasks: db.collection<TaskDocument>("tasks"),
  };

  let successCount = 0;
  let deploymentStatus: DeploymentStatus;
  const setDeploymentErrorStatus = (status: DeploymentStatus) => (deploymentStatus = status);

  const worker = new VaultWorker("./tasks/task/list/worker.js", {
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
            setDeploymentErrorStatus,
          });
          break;
        case "ERROR":
          onListError(tx, error, {
            task,
            collections,
            setDeploymentErrorStatus,
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
        setDeploymentErrorStatus,
      },
    );
    complete(successCount, deploymentStatus ? "FAILED" : "COMPLETED");
  });

  return worker;
}
