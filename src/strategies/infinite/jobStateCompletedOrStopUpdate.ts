import { findDeployment } from "../utils/shared.js";
import { scheduleTask } from "../../tasks/scheduleTask.js";
import { NosanaCollections } from "../../definitions/collection.js";

import { OnEvent, type StrategyListener } from "../../client/listener/types.js";
import { isActiveInfiniteDeployment } from "./utils/isActiveInfiniteDeployment.js";

import {
  DeploymentDocument,
  DeploymentStatus,
  EventDocument,
  EventType,
  type JobsDocument,
  JobsDocumentFields,
  JobState,
  TaskType,
} from "../../types/index.js";

const RAPID_COMPLETION_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const RAPID_COMPLETION_JOB_COUNT = 3;

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
      const deployment = await findDeployment(db, jobDeployment);
      if (!deployment || !isActiveInfiniteDeployment(deployment)) return;

      // --- Rapid-completion fail-safe ---
      const recentJobs = await db
        .collection<JobsDocument>(NosanaCollections.JOBS)
        .find({
          deployment: jobDeployment,
          state: { $in: [JobState.COMPLETED, JobState.STOPPED] },
          created_at: { $gte: deployment.updated_at },
        })
        .sort({ updated_at: -1 })
        .limit(RAPID_COMPLETION_JOB_COUNT)
        .toArray();

      if (recentJobs.length >= RAPID_COMPLETION_JOB_COUNT) {
        const allRapid = recentJobs.every((job) => {
          const duration = job.updated_at.getTime() - job.time_start;
          return duration < RAPID_COMPLETION_THRESHOLD_MS;
        });

        if (allRapid) {
          const { acknowledged } = await db
            .collection<DeploymentDocument>(NosanaCollections.DEPLOYMENTS)
            .updateOne(
              { id: jobDeployment, status: DeploymentStatus.RUNNING },
              { $set: { status: DeploymentStatus.STOPPING } },
            );

          if (acknowledged) {
            await db
              .collection<EventDocument>(NosanaCollections.EVENTS)
              .insertOne({
                category: EventType.DEPLOYMENT,
                deploymentId: jobDeployment,
                type: "RAPID_COMPLETION_FAIL_SAFE",
                message: `Deployment automatically stopped: last ${RAPID_COMPLETION_JOB_COUNT} jobs all completed in under 5 minutes.`,
                created_at: new Date(),
              });
          }

          return; // Do not schedule a replacement job
        }
      }

      // --- Schedule replacement job if under-provisioned ---
      const runningJobsCount = await db
        .collection<JobsDocument>(NosanaCollections.JOBS)
        .countDocuments({
          deployment: jobDeployment,
          state: {
            $in: [JobState.QUEUED, JobState.RUNNING],
          },
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
