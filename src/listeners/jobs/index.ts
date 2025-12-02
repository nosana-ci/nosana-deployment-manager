import { Db } from "mongodb";

import {
  createCollectionListener,
  CollectionListener,
} from "../../client/listener/index.js";

import {
  DeploymentDocument,
  DeploymentStrategy,
  JobsDocument,
  JobState,
  TaskType,
} from "../../types/index.js";
import { NosanaCollections } from "../../definitions/collection.js";
import { scheduleTask } from "../../tasks/scheduleTask.js";
import { getNextExtendTime } from "../../tasks/utils/getNextExtendTime.js";

export function startJobsCollectionListener(db: Db) {
  const listener: CollectionListener<JobsDocument> =
    createCollectionListener(NosanaCollections.JOBS, db);

  listener.addListener(
    "update",
    async ({ deployment: jobDeployment }) => {
      const deployment = await db.collection<DeploymentDocument>(NosanaCollections.DEPLOYMENTS).findOne({ deployment: jobDeployment });
      if (!deployment) return;

      if (deployment.strategy === DeploymentStrategy["SIMPLE-EXTEND"]) {
        scheduleTask(
          db,
          TaskType.EXTEND,
          deployment.id,
          deployment.status,
          getNextExtendTime(deployment.timeout)
        );
      }

      if (deployment.strategy === DeploymentStrategy.INFINITE) {
        // TODO: Implement infinite strategy task scheduling
        // Step 1: check how many current running jobs there are for this deployment
        // Step 2: if above replicas, schedule stop tasks for excess jobs (We might need to update the schedular to support this as we should only stop the oldest task)
      }
    },
    {
      fields: ["state"],
      filters: { state: { $eq: JobState.RUNNING } },
    }
  );

  listener.addListener(
    "update",
    async ({ deployment: jobDeployment }) => {
      const deployment = await db
        .collection<DeploymentDocument>(NosanaCollections.DEPLOYMENTS)
        .findOne({ deployment: jobDeployment });
      if (!deployment) return;

      if (deployment.strategy === DeploymentStrategy.INFINITE) {
        // Todo: Handle completed/stopped job for different strategies
        // Step 1: check how many current running jobs there are for this deployment
        // Step 2: if below replicas, schedule new job tasks
      }
    },
    {
      fields: ["state"],
      filters: { state: { $in: [JobState.COMPLETED, JobState.STOPPED] } },
    }
  );

  listener.start();
}
