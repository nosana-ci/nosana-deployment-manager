import { Collection } from "mongodb";

import {
  DeploymentStatus,
  EventDocument,
  OutstandingTasksDocument,
} from "../../../../types/index.js";
import { deploymentStatusFromError } from "../../deploymentStatusFromError.js";

export function onExtendError(
  error: string,
  events: Collection<EventDocument>,
  { deploymentId }: OutstandingTasksDocument,
  setError: (status: DeploymentStatus) => void,
  tx?: string
) {
  events.insertOne({
    deploymentId,
    category: "Deployment",
    type: "JOB_EXTEND_ERROR",
    message: error,
    tx,
    created_at: new Date(),
  });

  setError(deploymentStatusFromError(error));
}
