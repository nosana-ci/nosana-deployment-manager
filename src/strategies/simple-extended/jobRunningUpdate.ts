import { scheduleTask } from "../../tasks/scheduleTask.js";
import { getNextExtendTime } from "../../tasks/utils/getNextExtendTime.js";

import { findDeployment } from "../utils/shared.js";
import { OnEvent, type StrategyListener } from "../../client/listener/types.js";
import { DeploymentStrategy, JobsDocument, JobsDocumentFields, JobState, TaskType } from "../../types/index.js";

/**
 * Listener trigger when a job enters running state and the deployment is simple-extended
 * Schedules the first extend task with an initial buffer
 */
export const simpleExtendedJobRunningUpdate: StrategyListener<JobsDocument> = [
  OnEvent.UPDATE,
  async ({ deployment: jobDeployment, job }, db) => {
    const deployment = await findDeployment(db, jobDeployment);
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