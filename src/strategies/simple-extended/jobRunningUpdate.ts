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
    // Idempotent: a job's STATE can be written to RUNNING more than once (the kit
    // monitor can emit the claim event repeatedly, and the LIST-confirm reconcile
    // sets it too), and each write re-triggers this listener. Without this, every
    // duplicate RUNNING would queue another EXTEND. At most one PENDING extend per
    // (deployment, job) — matching the reschedule in onExtendConfirmed.
    scheduleTask(
      db,
      TaskType.EXTEND,
      deployment.id,
      deployment.status,
      getNextExtendTime(deployment.timeout),
      { job, idempotent: true }
    );
  },
  {
    fields: [JobsDocumentFields.STATE],
    filters: { state: { $eq: JobState.RUNNING } },
  }
];