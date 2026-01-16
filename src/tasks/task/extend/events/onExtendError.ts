import { Collection } from "mongodb";

import {
  DeploymentStatus,
  EventDocument,
  OutstandingTasksDocument,
} from "../../../../types/index.js";

export function onExtendError(
  error: string | undefined,
  setError: (status: DeploymentStatus) => void,
  events: Collection<EventDocument>,
  { deploymentId }: OutstandingTasksDocument
) {
  if (!error) return;

  events.insertOne({
    deploymentId,
    category: "Deployment",
    type: "JOB_EXTEND_ERROR",
    message: error,
    created_at: new Date(),
  });

  setError(error.includes("InsufficientFundsForRent") ? DeploymentStatus.INSUFFICIENT_FUNDS : DeploymentStatus.ERROR);
}
