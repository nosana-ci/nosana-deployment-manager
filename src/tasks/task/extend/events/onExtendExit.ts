import type {
  DeploymentStatus,
  DeploymentCollection,
  OutstandingTasksDocument,
} from "../../../../types/index.js";

export async function onExtendExit(
  newDeploymentStatus: DeploymentStatus | undefined,
  deployments: DeploymentCollection,
  { deploymentId }: OutstandingTasksDocument,
) {
  if (newDeploymentStatus) {
    deployments.updateOne({
      id: deploymentId
    }, {
      $set: {
        status: newDeploymentStatus
      }
    })
  }
}
