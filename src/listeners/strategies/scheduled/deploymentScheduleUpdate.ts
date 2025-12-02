import { updateScheduledTasks } from "../../../tasks/updateScheduledTasks.js";
import { getNextTaskTime } from "../../../tasks/utils/index.js";

import type { StrategyListener } from "../../../client/listener/types.js";
import { type DeploymentDocument, DeploymentStatus } from "../../../types/index.js";


/**
 * Listener that triggers when a deployment's schedule is updated.
 * It updates the scheduled tasks for the deployment based on the new schedule.
 */
export const deploymentScheduleUpdate: StrategyListener<DeploymentDocument> = [
  "update",
  ({ id, schedule }, db) => {
    updateScheduledTasks(db, id, getNextTaskTime(schedule!));
  },
  {
    fields: ["schedule"],
    filters: {
      status: { $ne: DeploymentStatus.DRAFT },
    }
  }
];