import { JobState } from "../../../../types/index.js";
import type { DeploymentCollection, DeploymentStatus, JobsCollection, OutstandingTasksDocument } from "../../../../types/index.js";

export function onStopExit(
  stoppedJobs: string[],
  jobsCollection: JobsCollection,
  { active_revision, deploymentId }: OutstandingTasksDocument,
  deployments: DeploymentCollection,
  newDeploymentStatus: DeploymentStatus | undefined
) {
  if (!active_revision) {
    jobsCollection.updateMany(
      {
        job: { $in: stoppedJobs },
        revision: { $ne: active_revision },
      },
      {
        $set: {
          state: JobState.STOPPED,
        },
      }
    );
  }

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
