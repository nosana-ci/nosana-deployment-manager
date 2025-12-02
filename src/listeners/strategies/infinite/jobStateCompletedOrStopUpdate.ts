import { scheduleTask } from "../../../tasks/scheduleTask.js";
import { NosanaCollections } from "../../../definitions/collection.js";
import type { StrategyListener } from "../../../client/listener/types.js";
import { DeploymentStrategy, JobsDocument, JobState, TaskType } from "../../../types/index.js";
import {findDeployment, STATE_FIELD, UPDATE_EVENT_TYPE} from "./shared.js";

/**
 * Listener trigger when a job enters running state and the deployment is simple-extended
 * Schedules the first extend task with an initial buffer
 * 
 * TODO:
 * - check if already scheduled - maybe create updateOrScheduleTask?
 */
export const infiniteJobStateCompletedOrStopUpdate: StrategyListener<JobsDocument> = [
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

    if (runningJobsCount < deployment.replicas) {
      const jobsToSchedule = deployment.replicas - runningJobsCount;
      scheduleTask(
        db,
        TaskType.LIST,
        deployment.id,
        deployment.status,
        new Date(),
        { limit: jobsToSchedule }
      );
    }
  },
  {
    fields: [STATE_FIELD],
    filters: { state: { $in: [JobState.COMPLETED, JobState.STOPPED] } },
  }
];