import { scheduleTask } from "../../tasks/scheduleTask.js";
import { getNextTaskTime } from "../../tasks/utils/index.js";

import { OnEvent, type StrategyListener } from "../../client/listener/types.js";
import { type DeploymentDocument, DeploymentDocumentFields, DeploymentStatus, DeploymentStrategy, TaskType } from "../../types/index.js";

/**
 * Listener that triggers when a deployment's active revision is updated.
 * It reconciles the deployment to the new revision: a STOP retiring the jobs
 * of every other revision and a LIST of the new one (at the next firing for a
 * SCHEDULED deployment). Both are keyed on the revision, so a duplicate change
 * event queues nothing twice, and neither checks the deployment's status: a
 * task the deployment no longer wants is dropped when it comes due.
 */
export const deploymentRevisionUpdate: StrategyListener<DeploymentDocument> = [
  OnEvent.UPDATE,
  async ({ id, active_revision, schedule, strategy, status }, db) => {
    await scheduleTask(db, TaskType.STOP, id, status, new Date(), { active_revision, reason: "revision", idempotent: true });
    await scheduleTask(db, TaskType.LIST, id, status, strategy === DeploymentStrategy.SCHEDULED
      ? getNextTaskTime(schedule)
      : undefined, { active_revision, reason: "revision", idempotent: true });
  },
  {
    fields: [DeploymentDocumentFields.ACTIVE_REVISION],
    filters: {
      status: { $ne: DeploymentStatus.DRAFT },
    }
  }
];
