import { Collection } from "mongodb";

import {
  DeploymentStatus,
  EventDocument,
  OutstandingTasksDocument,
} from "../../../../types/index.js";

export function onStopError(
  tx: string | undefined,
  error: string | undefined,
  collection: Collection<EventDocument>,
  { deploymentId }: OutstandingTasksDocument,
  deploymentErrorStatus: (status: DeploymentStatus) => void
) {
  if (!error) return;

  collection.insertOne({
    deploymentId,
    category: "Deployment",
    type: "JOB_STOP_ERROR",
    tx,
    message: error,
    created_at: new Date(),
  });

  deploymentErrorStatus(error.includes("InsufficientFundsForRent") ? DeploymentStatus.INSUFFICIENT_FUNDS : DeploymentStatus.ERROR);
}
