import { findDeployment } from "../utils/shared.js";
import { scheduleTask } from "../../tasks/scheduleTask.js";
import { NosanaCollections } from "../../definitions/collection.js";

import { OnEvent, type StrategyListener } from "../../client/listener/types.js";
import { armStartupDeadline } from "./utils/armStartupDeadline.js";
import { isActiveInfiniteDeployment } from "./utils/isActiveInfiniteDeployment.js";
import { getTimeNthMinutesBeforeTimeout } from "../../tasks/utils/getTimeNthMinutesBeforeTimeout.js";

import { type JobsDocument, JobsDocumentFields, JobState, TaskType } from "../../types/index.js";

/**
 * A job of an INFINITE deployment started RUNNING on a node:
 *   - its startup deadline is armed;
 *   - if it took the active revision over `replicas` (it replaces a job being
 *     rotated out), one job is stopped, once however often the job is written
 *     RUNNING while that stop is pending. Only the active revision counts:
 *     during a revision swap the old revision's jobs are the swap's STOP's to retire;
 *   - its rotation is scheduled: a LIST of the job's own revision,
 *     `rotation_time` before the job times out, keyed on the job so a job
 *     written RUNNING twice queues it once. It is the job's replacement to be:
 *     listed ahead of the end when a node is spare, or as soon as the job ends
 *     (see `infiniteJobStateCompletedOrStopUpdate`).
 */
export const infiniteJobRunningUpdate: StrategyListener<JobsDocument> = [
  OnEvent.UPDATE,
  async ({ deployment: jobDeployment, job, revision }, db) => {
    const deployment = await findDeployment(db, jobDeployment);
    if (!deployment || !isActiveInfiniteDeployment(deployment)) return;;

    // A node has taken the job: start its startup-timeout clock (no-op unless the
    // deployment configured one).
    await armStartupDeadline(db, deployment, job);

    const runningJobsCount = await db
      .collection<JobsDocument>(NosanaCollections.JOBS)
      .countDocuments({
        deployment: jobDeployment,
        revision: deployment.active_revision,
        state: {
          $in: [JobState.QUEUED, JobState.RUNNING],
        },
      });

    if (runningJobsCount > deployment.replicas) {
      await scheduleTask(
        db,
        TaskType.STOP,
        deployment.id,
        deployment.status,
        new Date(),
        {
          limit: 1,
          reason: "overcount",
          idempotent: true,
        },
      )
    }

    await scheduleTask(
      db,
      TaskType.LIST,
      deployment.id,
      deployment.status,
      getTimeNthMinutesBeforeTimeout(deployment.timeout, deployment.rotation_time),
      {
        job,
        limit: 1,
        active_revision: revision,
        idempotent: true,
      }
    )
  },
  {
    fields: [JobsDocumentFields.STATE],
    filters: { state: { $eq: JobState.RUNNING } },
  }
];

