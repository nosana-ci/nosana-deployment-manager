import { findDeployment } from "../utils/shared.js";
import { NosanaCollections } from "../../definitions/collection.js";

import { OnEvent, type StrategyListener } from "../../client/listener/types.js";
import { isSimpleOrSimpleExtendedDeployment } from "../utils/isSimpleOrSimpleExtendedDeployment.js";

import { DeploymentDocument, DeploymentStatus, type JobsDocument, JobsDocumentFields, JobState, TaskDocument } from "../../types/index.js";

/**
 * 
 */
export const jobAllActiveJobsStop: StrategyListener<JobsDocument> = [
  OnEvent.UPDATE,
  async ({ job, deployment: jobDeployment }, db) => {
    db.collection<TaskDocument>(NosanaCollections.TASKS).deleteMany({
      deploymentId: jobDeployment,
      job: {
        $eq: job,
      },
    });

    const deployment = await findDeployment(db, jobDeployment);
    if (!deployment || !isSimpleOrSimpleExtendedDeployment(deployment) && deployment.status !== DeploymentStatus.STOPPING) return;

    const runningJobsCount = await db
      .collection<JobsDocument>(NosanaCollections.JOBS)
      .countDocuments({
        deployment: jobDeployment,
        state: {
          $in: [JobState.QUEUED, JobState.RUNNING],
        },
      });

    if (runningJobsCount === 0) {
      const { acknowledged } = await db.collection<DeploymentDocument>(NosanaCollections.DEPLOYMENTS).updateOne(
        {
          id: jobDeployment,
          status: { $nin: [DeploymentStatus.ERROR, DeploymentStatus.INSUFFICIENT_FUNDS] }
        },
        { $set: { status: DeploymentStatus.STOPPED } }
      );

      if (!acknowledged) {
        console.error(`Failed to update deployment ${jobDeployment} to STOPPED status.`);
        return;
      }
    }
  },
  {
    fields: [JobsDocumentFields.STATE],
    filters: { state: { $in: [JobState.COMPLETED, JobState.STOPPED] } },
  }
];

