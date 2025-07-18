import { Collection } from "mongodb";

import {
  DeploymentDocument,
  DeploymentStatus,
  OutstandingTasksDocument,
} from "../../../../types.js";

export function onStopExit(
  errorStatus: DeploymentStatus | undefined,
  documents: Collection<DeploymentDocument>,
  { deploymentId }: OutstandingTasksDocument
) {
  documents.updateOne(
    {
      id: { $eq: deploymentId },
    },
    {
      $set: {
        status: errorStatus ?? DeploymentStatus.STOPPED,
      },
    }
  );
}
