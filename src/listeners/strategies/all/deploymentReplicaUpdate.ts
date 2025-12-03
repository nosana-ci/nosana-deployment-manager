import { scheduleTask } from "../../../tasks/scheduleTask.js";


import { OnEvent, type StrategyListener } from "../../../client/listener/types.js";
import { type DeploymentDocument, DeploymentDocumentFields, DeploymentStrategy, TaskType } from "../../../types/index.js";

/**
 * Listener that triggers when a deployment's replica count is updated.
 * It schedules a LIST task for the deployment when the replica count changes,
 * considering the deployment strategy is not SCHEDULED.
 * 
 * TODO:
 * - Support infinite strategy
 * - Support replica downscaling
 */
export const deploymentReplicaUpdate: StrategyListener<DeploymentDocument> = [
  OnEvent.UPDATE,
  ({ id, status }, db) => {
    scheduleTask(db, TaskType.LIST, id, status)
  }, {
    fields: [DeploymentDocumentFields.REPLICAS],
    filters: {
      strategy: { $or: [DeploymentStrategy.SIMPLE, DeploymentStrategy["SIMPLE-EXTEND"]] }
    }
  }
];