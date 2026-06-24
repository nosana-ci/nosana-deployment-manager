import {
  DeploymentStatus,
  EventsCollection,
  OutstandingTasksDocument,
} from "../../../../types/index.js";
import { deploymentStatusFromError } from "../../deploymentStatusFromError.js";

export function onListError(
  events: EventsCollection,
  task: OutstandingTasksDocument,
  error: string,
  setDeploymentErrorStatus: (status: DeploymentStatus) => void,
  tx?: string
) {
  events.insertOne({
    deploymentId: task.deploymentId,
    category: "Deployment",
    type: "JOB_LIST_ERROR",
    message: error,
    tx,
    created_at: new Date(),
  });

  setDeploymentErrorStatus(deploymentStatusFromError(error));
}
