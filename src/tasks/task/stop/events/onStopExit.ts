import { ACTIVE_JOB_STATES, DeploymentStatus, JobState } from "../../../../types/index.js";
import type { DeploymentCollection, JobsCollection, OutstandingTasksDocument } from "../../../../types/index.js";

export async function onStopExit(
  stoppedJobs: string[],
  jobsCollection: JobsCollection,
  { deploymentId }: OutstandingTasksDocument,
  deployments: DeploymentCollection
) {
  // Record what this stop settled without waiting for the accounts listener,
  // whatever kind of stop it was. A job that settled on its own first (a
  // no-op confirmation) keeps its own terminal state.
  jobsCollection.updateMany(
    {
      job: { $in: stoppedJobs },
      state: { $in: [...ACTIVE_JOB_STATES] },
    },
    {
      $set: {
        state: JobState.STOPPED,
        updated_at: new Date(),
      },
    }
  );

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
