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
        }
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
      }
    },
    {
      fields: ["state"],
      filters: { state: { $in: [JobState.COMPLETED, JobState.STOPPED] } },
    }
  );

  listener.start();
}
