import { scheduleTask } from "../../../tasks/scheduleTask.js";
import { NosanaCollections } from "../../../definitions/collection.js";
import { getNextExtendTime } from "../../../tasks/utils/getNextExtendTime.js";


import type { StrategyListener } from "../../../client/listener/types.js";
import { type DeploymentDocument, DeploymentStrategy, JobsDocument, JobState, TaskType } from "../../../types/index.js";

/**
 * Listener trigger when a job enters running state and the deployment is simple-extended
 * Schedules the first extend task with an initial buffer
 * 
 * TODO:
 * - check if already scheduled - maybe create updateOrScheduleTask?
 */
export const simpleExtendedJobRunningUpdate: StrategyListener<JobsDocument> = [
  "update",
  async ({ deployment: jobDeployment }, db) => {
    const deployment = await db.collection<DeploymentDocument>(NosanaCollections.DEPLOYMENTS).findOne({ deployment: jobDeployment });
    if (!deployment || deployment.strategy !== DeploymentStrategy["SIMPLE-EXTEND"]) return;

    scheduleTask(
      db,
      TaskType.EXTEND,
      deployment.id,
      deployment.status,
      getNextExtendTime(deployment.timeout)
    );
  },
  {
    fields: ["state"],
    filters: { state: { $eq: JobState.RUNNING } },
  }
];