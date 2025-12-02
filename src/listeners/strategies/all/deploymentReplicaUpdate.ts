import { scheduleTask } from "../../../tasks/scheduleTask.js";


import type { StrategyListener } from "../../../client/listener/types.js";
import { type DeploymentDocument, DeploymentStrategy, TaskType } from "../../../types/index.js";

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
  "update",
  ({ id, status }, db) => {
    scheduleTask(db, TaskType.LIST, id, status)
  }, {
    fields: ["replicas"],
    filters: {
      strategy: { $or: [DeploymentStrategy.SIMPLE, DeploymentStrategy["SIMPLE-EXTEND"]] }
    }
  }
];