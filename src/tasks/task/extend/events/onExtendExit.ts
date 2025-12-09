import type {
  DeploymentStatus,
  DeploymentCollection,
  OutstandingTasksDocument,
} from "../../../../types/index.js";

export async function onExtendExit(
  deploymentStatus: DeploymentStatus | undefined,
  deployments: DeploymentCollection,
  { deploymentId }: OutstandingTasksDocument,
) {
  if (deploymentStatus) {
    deployments.updateOne(
      {
        id: {
          $eq: deploymentId,
        },
      },
      {
        $set: {
          status: deploymentStatus,
        },
      }
    );
  }
}
