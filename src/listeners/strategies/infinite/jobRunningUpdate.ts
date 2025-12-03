import { findDeployment } from "../utils/shared.js";
import { scheduleTask } from "../../../tasks/scheduleTask.js";
import { NosanaCollections } from "../../../definitions/collection.js";

import { OnEvent, type StrategyListener } from "../../../client/listener/types.js";
import { DeploymentStrategy, JobsDocument, JobsDocumentFields, JobState, TaskType } from "../../../types/index.js";
import { getTimeNthMinutesBeforeTimeout } from "../../../tasks/utils/getTimeNthMinutesBeforeTimeout.js";

/**
 * 
 */
export const infiniteJobRunningUpdate: StrategyListener<JobsDocument> = [
  OnEvent.UPDATE,
  async ({ deployment: jobDeployment }, db) => {
    const deployment = await findDeployment(db, jobDeployment);
    if (!deployment || deployment.strategy !== DeploymentStrategy.INFINITE) return;

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
      // Schedule a new task for Nth minutes before timeout
      scheduleTask(
        db,
        TaskType.LIST,
        deployment.id,
        deployment.status,
        getTimeNthMinutesBeforeTimeout(deployment.timeout),
        {
          limit: 1,
        }
      )
    }

  },
  {
    fields: [JobsDocumentFields.STATE],
    filters: { state: { $eq: JobState.RUNNING } },
  }
];

