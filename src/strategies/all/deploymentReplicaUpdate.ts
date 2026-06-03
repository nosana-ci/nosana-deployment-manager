import { scheduleTask } from "../../tasks/scheduleTask.js";
import { NosanaCollections } from "../../definitions/collection.js";

import { OnEvent, type StrategyListener } from "../../client/listener/types.js";
import {
  type DeploymentDocument,
  DeploymentDocumentFields,
  DeploymentStatus,
  DeploymentStrategy,
  type JobsDocument,
  JobState,
  TaskType,
} from "../../types/index.js";

/**
 * Listener that reconciles a running deployment's jobs when its replica count
 * changes, for the SIMPLE, SIMPLE-EXTEND and INFINITE strategies:
 *
 * - Upscale (active jobs < replicas): schedule a LIST task limited to the
 *   shortfall, so only the missing jobs are added (not the full replica count).
 * - Downscale (active jobs > replicas): schedule a STOP task limited to the
 *   excess. The STOP worker cancels QUEUED jobs before terminating RUNNING
 *   ones, oldest first (see selectJobsToStop). For INFINITE this is safe: each
 *   stopped job's pending rotation LIST is removed by jobAllActiveJobsStop, and
 *   infiniteJobStateCompletedOrStopUpdate only re-lists while under replicas, so
 *   the count settles at the new target without refilling.
 *
 */
export const deploymentReplicaUpdate: StrategyListener<DeploymentDocument> = [
  OnEvent.UPDATE,
  async ({ id, status, replicas }, db) => {
    const activeJobsCount = await db
      .collection<JobsDocument>(NosanaCollections.JOBS)
      .countDocuments({
        deployment: id,
        state: { $in: [JobState.QUEUED, JobState.RUNNING] },
      });

    if (activeJobsCount > replicas) {
      // Downscale: stop the excess jobs.
      scheduleTask(db, TaskType.STOP, id, status, new Date(), {
        limit: activeJobsCount - replicas,
      });
      return;
    }

    if (activeJobsCount < replicas) {
      // Upscale: list only the shortfall (an explicit limit is required for
      scheduleTask(db, TaskType.LIST, id, status, undefined, {
        limit: replicas - activeJobsCount,
      });
    }
  },
  {
    fields: [DeploymentDocumentFields.REPLICAS],
    filters: {
      strategy: {
        $in: [
          DeploymentStrategy.SIMPLE,
          DeploymentStrategy["SIMPLE-EXTEND"],
          DeploymentStrategy.INFINITE,
        ],
      },
      status: { $eq: DeploymentStatus.RUNNING },
    },
  }
];
