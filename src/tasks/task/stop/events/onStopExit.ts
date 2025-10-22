import { Collection } from "mongodb";

import {
  DeploymentDocument,
  DeploymentStatus,
  JobsCollection,
  OutstandingTasksDocument,
} from "../../../../types/index.js";

export function onStopExit(
  errorStatus: DeploymentStatus | undefined,
  deploymentsCollection: Collection<DeploymentDocument>,
  jobsCollection: Collection<JobsCollection>,
  { active_revision, deploymentId, jobs }: OutstandingTasksDocument
) {
  deploymentsCollection.updateOne(
    {
      id: { $eq: deploymentId },
    },
    {
      $set: {
        status: errorStatus ?? DeploymentStatus.STOPPED,
      },
    }
  );

  jobsCollection.updateMany(
    {
      job: { $in: jobs.map(({ job }) => job) },
      revision: { $ne: active_revision },
    },
    {
      $set: {
        status: "COMPLETED",
      },
    }
  );
}
