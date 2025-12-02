import { scheduleTask } from "../../../tasks/scheduleTask.js";
import { NosanaCollections } from "../../../definitions/collection.js";
import type { StrategyListener } from "../../../client/listener/types.js";
import { DeploymentStrategy, JobsDocument, JobState, TaskType } from "../../../types/index.js";
import {findDeployment, STATE_FIELD, UPDATE_EVENT_TYPE} from "./shared.js";

const TWENTY_MINUTES_IN_SECONDS = 1200;

export function getTimeTwentyMinutesBeforeTimeout(timeout: number) {
  return new Date(Date.now() + (timeout - TWENTY_MINUTES_IN_SECONDS) * 1000);
}

/**
 * 
 */
export const infiniteJobRunningUpdate: StrategyListener<JobsDocument> = [
  UPDATE_EVENT_TYPE,
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
      // Schedule a new task for 20 minutes before timeout
      let twentyMinutesBeforeTimeout = getTimeTwentyMinutesBeforeTimeout(deployment.timeout);
      scheduleTask(
        db,
        TaskType.LIST,
        deployment.id,
        deployment.status,
        twentyMinutesBeforeTimeout
      )
    }

  },
  {
    fields: [STATE_FIELD],
    filters: { state: { $eq: JobState.RUNNING } },
  }
];

