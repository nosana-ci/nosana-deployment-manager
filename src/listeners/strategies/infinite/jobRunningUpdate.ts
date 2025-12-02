

import { scheduleTask } from "../../../tasks/scheduleTask.js";
import { NosanaCollections } from "../../../definitions/collection.js";


import type { StrategyListener } from "../../../client/listener/types.js";
import { type DeploymentDocument, DeploymentStrategy, JobsDocument, JobState, TaskType } from "../../../types/index.js";

/**
 * 
 */
export const infiniteJobRunningUpdate: StrategyListener<JobsDocument> = [
  "update",
  async ({ deployment: jobDeployment }, db) => {
    const deployment = await db.collection<DeploymentDocument>(NosanaCollections.DEPLOYMENTS).findOne({ deployment: jobDeployment });
    if (!deployment || deployment.strategy === DeploymentStrategy.INFINITE) return;

    const runningJobsCount = await db
      .collection<JobsDocument>(NosanaCollections.JOBS)
      .countDocuments({
        deployment: jobDeployment,
        state: {
          $in: [JobState.QUEUED, JobState.RUNNING],
        },
      });

    if (runningJobsCount > deployment.replicas) {
      const excessJobs = runningJobsCount - deployment.replicas;
      scheduleTask(
        db,
        TaskType.STOP,
        deployment.id,
        deployment.status,
        new Date(),
        { limit: excessJobs }
      )
    } else {
      // No excess jobs to stop
      // TODO: Schedule future rotation
    }

  },
  {
    fields: ["state"],
    filters: { state: { $eq: JobState.RUNNING } },
  }
];

