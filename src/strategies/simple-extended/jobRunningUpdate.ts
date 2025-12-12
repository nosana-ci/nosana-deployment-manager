import { scheduleTask } from "../../tasks/scheduleTask.js";
import { NosanaCollections } from "../../definitions/collection.js";
import { getNextExtendTime } from "../../tasks/utils/getNextExtendTime.js";


import { OnEvent, type StrategyListener } from "../../client/listener/types.js";
import { type DeploymentDocument, DeploymentStrategy, JobsDocument, JobsDocumentFields, JobState, TaskType } from "../../types/index.js";

/**
 * Listener trigger when a job enters running state and the deployment is simple-extended
 * Schedules the first extend task with an initial buffer
 */
export const simpleExtendedJobRunningUpdate: StrategyListener<JobsDocument> = [
  OnEvent.UPDATE,
  async ({ deployment: jobDeployment, job }, db) => {
    const deployment = await db.collection<DeploymentDocument>(NosanaCollections.DEPLOYMENTS).findOne({ deployment: jobDeployment });
    if (!deployment || deployment.strategy !== DeploymentStrategy["SIMPLE-EXTEND"]) return;

    scheduleTask(
      db,
      TaskType.EXTEND,
      deployment.id,
      deployment.status,
      getNextExtendTime(deployment.timeout),
      { job }
    );
  },
  {
    fields: [JobsDocumentFields.STATE],
    filters: { state: { $eq: JobState.RUNNING } },
  }
];