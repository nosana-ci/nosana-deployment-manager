import { DeploymentStatus, JobState } from "../../../../types/index.js";
import type { DeploymentCollection, JobsCollection, OutstandingTasksDocument } from "../../../../types/index.js";

export async function onStopExit(
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
    });
    return;
  }

  // When the STOP task finishes without stopping any jobs (e.g. all jobs
  // already completed/stopped), check if the deployment should move to STOPPED.
  if (stoppedJobs.length === 0) {
    const activeJobsCount = await jobsCollection.countDocuments({
      deployment: deploymentId,
      state: { $in: [JobState.QUEUED, JobState.RUNNING] },
    });

    if (activeJobsCount === 0) {
      deployments.updateOne(
        {
          id: deploymentId,
          status: DeploymentStatus.STOPPING,
        },
        {
          $set: { status: DeploymentStatus.STOPPED },
        },
      );
    }
  }
}
