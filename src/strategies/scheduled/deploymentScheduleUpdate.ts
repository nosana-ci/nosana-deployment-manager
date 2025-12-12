import { updateScheduledTasks } from "../../tasks/updateScheduledTasks.js";
import { getNextTaskTime } from "../../tasks/utils/index.js";

import { OnEvent, type StrategyListener } from "../../client/listener/types.js";
import { type DeploymentDocument, DeploymentDocumentFields, DeploymentStatus } from "../../types/index.js";


/**
 * Listener that triggers when a deployment's schedule is updated.
 * It updates the scheduled tasks for the deployment based on the new schedule.
 */
export const deploymentScheduleUpdate: StrategyListener<DeploymentDocument> = [
  OnEvent.UPDATE,
  ({ id, schedule }, db) => {
    updateScheduledTasks(db, id, getNextTaskTime(schedule!));
  },
  {
    fields: [DeploymentDocumentFields.SCHEDULE],
    filters: {
      status: { $ne: DeploymentStatus.DRAFT },
    }
  }
];