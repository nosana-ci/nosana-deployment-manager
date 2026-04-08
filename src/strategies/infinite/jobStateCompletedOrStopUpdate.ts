import { findDeployment } from "../utils/shared.js";
import { scheduleTask } from "../../tasks/scheduleTask.js";

import { OnEvent, type StrategyListener } from "../../client/listener/types.js";
import { isActiveInfiniteDeployment } from "./utils/isActiveInfiniteDeployment.js";

import {
  DeploymentStatus,
  EventType,
  type JobsDocument,
  JobsDocumentFields,
  JobState,
  TaskType,
} from "../../types/index.js";
import { DeploymentsRepository, EventsRepository, JobsRepository, withTransaction } from "../../repositories/index.js";
import { allJobsRapid } from "./utils/allJobsRapid.js";
import { getConfig } from "../../config/index.js";
/**
 * Listener triggered when an infinite deployment job completes or stops.
 * First checks the rapid-completion fail-safe: if the last 3 jobs (created
 * since `deployment.updated_at`) all ran for under 5 minutes, the deployment
 * is moved to STOPPING and no replacement job is scheduled.
 * Otherwise, schedules a new LIST task if replicas are under-provisioned.
 *
 * TODO:
 * - check if already scheduled - maybe create updateOrScheduleTask?
 */
export const infiniteJobStateCompletedOrStopUpdate: StrategyListener<JobsDocument> =
  [
    OnEvent.UPDATE,
    async ({ deployment: jobDeployment }, db) => {
      const { rapid_completion_job_count, rapid_completion_threshold_minutes } = getConfig();
      const deployment = await findDeployment(db, jobDeployment);
      if (!deployment || !isActiveInfiniteDeployment(deployment)) return;

      const recentJobs = await JobsRepository.findAll({
        deployment: jobDeployment,
        state: { $in: [JobState.COMPLETED, JobState.STOPPED] },
        created_at: { $gte: deployment.updated_at },
      }, {
        sort: { updated_at: -1 },
        limit: deployment.replicas * rapid_completion_job_count,
      })

      if (allJobsRapid(recentJobs)) {
        await withTransaction(async (session) => {
          const updated = await DeploymentsRepository.update(
            { id: deployment.id, status: DeploymentStatus.RUNNING },
            { status: DeploymentStatus.STOPPING },
            { session },
          );
          if (!updated) return;

          await EventsRepository.create({
            category: EventType.DEPLOYMENT,
            deploymentId: deployment.id,
            type: "RAPID_COMPLETION_FAIL_SAFE",
            message: `Deployment automatically stopped: last ${rapid_completion_job_count} jobs all completed in under ${rapid_completion_threshold_minutes} minutes.`,
            created_at: new Date(),
          }, { session });
        });

        return;
      }

      // --- Schedule replacement job if under-provisioned ---
      const runningJobsCount = await JobsRepository.count({
        deployment: jobDeployment,
        state: { $in: [JobState.QUEUED, JobState.RUNNING] },
      });

      if (runningJobsCount < deployment.replicas) {
        scheduleTask(
          db,
          TaskType.LIST,
          deployment.id,
          deployment.status,
          new Date(),
          { limit: 1 },
        );
      }
    },
    {
      fields: [JobsDocumentFields.STATE],
      filters: { state: { $in: [JobState.COMPLETED, JobState.STOPPED] } },
    },
  ];
