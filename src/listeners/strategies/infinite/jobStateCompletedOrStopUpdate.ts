import { findDeployment } from "../utils/shared.js";
import { scheduleTask } from "../../../tasks/scheduleTask.js";
import { NosanaCollections } from "../../../definitions/collection.js";

import { OnEvent, type StrategyListener } from "../../../client/listener/types.js";
import { DeploymentStrategy, JobsDocument, JobsDocumentFields, JobState, TaskType } from "../../../types/index.js";

/**
 * Listener trigger when a job enters running state and the deployment is simple-extended
 * Schedules the first extend task with an initial buffer
 * 
 * TODO:
 * - check if already scheduled - maybe create updateOrScheduleTask?
 */
export const infiniteJobStateCompletedOrStopUpdate: StrategyListener<JobsDocument> = [
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
    fields: [JobsDocumentFields.STATE],
    filters: { state: { $in: [JobState.COMPLETED, JobState.STOPPED] } },
  }
];