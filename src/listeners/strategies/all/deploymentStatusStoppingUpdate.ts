import { scheduleTask } from "../../../tasks/scheduleTask.js";

import type { StrategyListener } from "../../../client/listener/types.js";
import { type DeploymentDocument, DeploymentStatus, TaskType } from "../../../types/index.js";

/**
 * Listener to handle deployment status updates to STOPPING.
 * Schedules a STOP task for the deployment when its status changes to STOPPING.
 */
export const deploymentStatusStoppingUpdate: StrategyListener<DeploymentDocument> = [
  "update",
  ({ id, status }, db) => {
    scheduleTask(db, TaskType.STOP, id, status)
  },
  {
    fields: ["status"],
    filters: {
      status: { $eq: DeploymentStatus.STOPPING },
    }
  }
];