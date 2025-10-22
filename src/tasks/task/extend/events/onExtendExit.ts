import { Db } from "mongodb";

import { scheduleTask } from "../../../scheduleTask.js";

import {
  DeploymentStatus,
  TaskType,
  DeploymentCollection,
  OutstandingTasksDocument,
} from "../../../../types/index.js";

export async function onExtendExit(
  errorStatus: DeploymentStatus | undefined,
  deployments: DeploymentCollection,
  { deploymentId, deployment: { timeout, status } }: OutstandingTasksDocument,
  db: Db
) {
  if (errorStatus) {
    deployments.updateOne(
      {
        id: {
          $eq: deploymentId,
        },
      },
      {
        $set: {
          status: errorStatus,
        },
      }
    );
    return;
  }

  scheduleTask(
    db,
    TaskType.EXTEND,
    deploymentId,
    status,
    new Date(new Date().getTime() + timeout * 1000)
  );
}
