import { Collection } from "mongodb";

import {
  DeploymentStatus,
  EventDocument,
  OutstandingTasksDocument,
} from "../../../../types/index.js";

export function onStopError(
  tx: string | undefined,
  error: string | null | undefined,
  collection: Collection<EventDocument>,
  { deploymentId }: OutstandingTasksDocument,
  setErrorType: (status: DeploymentStatus) => void
) {
  if (!error || error === null) return;

  collection.insertOne({
    deploymentId,
    category: "Deployment",
    type: "JOB_STOP_ERROR",
    tx,
    message: error,
    created_at: new Date(),
  });

  setErrorType(error.includes("InsufficientFundsForRent") ? DeploymentStatus.INSUFFICIENT_FUNDS : DeploymentStatus.ERROR);
}
