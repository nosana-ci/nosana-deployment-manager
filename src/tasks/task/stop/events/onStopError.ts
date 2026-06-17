import { Collection } from "mongodb";

import {
  DeploymentStatus,
  EventDocument,
  OutstandingTasksDocument,
} from "../../../../types/index.js";
import { deploymentStatusFromError } from "../../deploymentStatusFromError.js";

export function onStopError(
  error: string,
  collection: Collection<EventDocument>,
  { deploymentId }: OutstandingTasksDocument,
  deploymentErrorStatus: (status: DeploymentStatus) => void,
  tx?: string
) {
  collection.insertOne({
    deploymentId,
    category: "Deployment",
    type: "JOB_STOP_ERROR",
    message: error,
    tx,
    created_at: new Date(),
  });

  deploymentErrorStatus(deploymentStatusFromError(error));
}
