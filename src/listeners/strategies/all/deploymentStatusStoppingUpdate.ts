import { scheduleTask } from "../../../tasks/scheduleTask.js";

import { OnEvent, type StrategyListener } from "../../../client/listener/types.js";
import { type DeploymentDocument, DeploymentDocumentFields, DeploymentStatus, TaskType } from "../../../types/index.js";

/**
 * Listener to handle deployment status updates to STOPPING.
 * Schedules a STOP task for the deployment when its status changes to STOPPING.
 */
export const deploymentStatusStoppingUpdate: StrategyListener<DeploymentDocument> = [
  OnEvent.UPDATE,
  ({ id, status }, db) => {
    scheduleTask(db, TaskType.STOP, id, status)
  },
  {
    fields: [DeploymentDocumentFields.STATUS],
    filters: {
      status: { $eq: DeploymentStatus.STOPPING },
    }
  }
];