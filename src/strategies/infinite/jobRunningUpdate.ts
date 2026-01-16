import { findDeployment } from "../utils/shared.js";
import { scheduleTask } from "../../tasks/scheduleTask.js";
import { NosanaCollections } from "../../definitions/collection.js";

import { OnEvent, type StrategyListener } from "../../client/listener/types.js";
import { isActiveInfiniteDeployment } from "./utils/isActiveInfiniteDeployment.js";
import { getTimeNthMinutesBeforeTimeout } from "../../tasks/utils/getTimeNthMinutesBeforeTimeout.js";

import { type JobsDocument, JobsDocumentFields, JobState, TaskType } from "../../types/index.js";

/**
 * 
 */
export const infiniteJobRunningUpdate: StrategyListener<JobsDocument> = [
  OnEvent.UPDATE,
  async ({ deployment: jobDeployment, job }, db) => {
    const deployment = await findDeployment(db, jobDeployment);
    if (!deployment || !isActiveInfiniteDeployment(deployment)) return;;

    const runningJobsCount = await db
      .collection<JobsDocument>(NosanaCollections.JOBS)
      .countDocuments({
        deployment: jobDeployment,
        state: {
          $in: [JobState.QUEUED, JobState.RUNNING],
        },
      });

    if (runningJobsCount > deployment.replicas) {
      scheduleTask(
        db,
        TaskType.STOP,
        deployment.id,
        deployment.status,
        new Date(),
        {
          limit: 1
        },
      )
    }

    scheduleTask(
      db,
      TaskType.LIST,
      deployment.id,
      deployment.status,
      getTimeNthMinutesBeforeTimeout(deployment.timeout, deployment.rotation_time),
      {
        job,
        limit: 1,
      }
    )
  },
  {
    fields: [JobsDocumentFields.STATE],
    filters: { state: { $eq: JobState.RUNNING } },
  }
];

