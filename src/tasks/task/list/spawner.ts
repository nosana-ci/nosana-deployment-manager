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
  newDeploymentStatus?: DeploymentStatus | undefined;
  setDeploymentErrorStatus: (type: DeploymentStatus) => void;
  collections: {
    events: Collection<EventDocument>;
    deployments: Collection<DeploymentDocument>;
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
  console.log("DEBUG :: Spawning LIST task for deployment:", task.deploymentId);
  const collections = {
    deployments: db.collection<DeploymentDocument>("deployments"),
    events: db.collection<EventDocument>("events"),
    jobs: db.collection<JobsDocument>("jobs"),
    tasks: db.collection<TaskDocument>("tasks"),
  };

  let successCount = 0;
  let newDeploymentStatus: DeploymentStatus | undefined = undefined;
  const setDeploymentErrorStatus = async (status: DeploymentStatus) => {
    newDeploymentStatus = status
  };

  const worker = new VaultWorker("../tasks/task/list/worker.js", {
    workerData: {
      task,
      vault: task.deployment.vault.vault_key,
      confidential_ipfs_pin: getConfig().confidential_ipfs_pin
    },
  });

  worker.on(
    "message",
    ({ event, error, job, tx }: WorkerEventMessage) => {
      console.log("DEBUG :: List Worker Message:", event, error, job, tx);
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
        newDeploymentStatus,
        setDeploymentErrorStatus,
      },
    );
    complete(successCount, newDeploymentStatus ? "FAILED" : "COMPLETED");
  });

  return worker;
}
