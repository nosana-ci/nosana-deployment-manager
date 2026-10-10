import { findDeployment } from "../utils/shared.js";
import { NosanaCollections } from "../../definitions/collection.js";
import { TasksRepository } from "../../repositories/index.js";

import { OnEvent, type StrategyListener } from "../../client/listener/types.js";
import { isSimpleOrSimpleExtendedDeployment } from "../utils/isSimpleOrSimpleExtendedDeployment.js";

import { DeploymentDocument, DeploymentStatus, type JobsDocument, JobsDocumentFields, JobState, TaskDocument, TaskType } from "../../types/index.js";

/**
 * Housekeeping when a job settles: drops the job's own pending EXTEND/STOP
 * tasks, and for SIMPLE / SIMPLE-EXTEND (or any deployment being STOPPING)
 * flips the deployment to STOPPED once no active job is left.
 *
 * A RUNNING deployment with a LIST still queued or in flight is NOT flipped:
 * replacements are on their way (a market swap, a revision swap, an upscale)
 * and would otherwise land in a deployment already marked STOPPED. Only
 * RUNNING is guarded — a STOPPING deployment swept its lists in the STOP
 * task's housekeeping, and must still settle to STOPPED.
 *
 * A LIST keyed on the job (an INFINITE rotation) is left alone: it may be about
 * to replace the job, which `infiniteJobStateCompletedOrStopUpdate` decides.
 */
export const jobAllActiveJobsStop: StrategyListener<JobsDocument> = [
  OnEvent.UPDATE,
  async ({ job, deployment: jobDeployment }, db) => {
    await TasksRepository.delete({
      deploymentId: jobDeployment,
      job: {
        $eq: job,
      },
      task: { $ne: TaskType.LIST },
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
      if (deployment.status === DeploymentStatus.RUNNING) {
        const pendingLists = await db
          .collection<TaskDocument>(NosanaCollections.TASKS)
          .countDocuments({ deploymentId: jobDeployment, task: TaskType.LIST });
        if (pendingLists > 0) return;
      }

      const { acknowledged } = await db.collection<DeploymentDocument>(NosanaCollections.DEPLOYMENTS).updateOne(
        {
          id: jobDeployment,
          // ARCHIVED is terminal (foul-play teardown) — never revive it to STOPPED
          // when its last delisted job settles.
          status: { $nin: [DeploymentStatus.ERROR, DeploymentStatus.INSUFFICIENT_FUNDS, DeploymentStatus.ARCHIVED] }
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

