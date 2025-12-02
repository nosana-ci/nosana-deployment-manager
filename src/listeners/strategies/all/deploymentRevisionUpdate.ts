import { scheduleTask } from "../../../tasks/scheduleTask.js";
import { getNextTaskTime } from "../../../tasks/utils/index.js";

import type { StrategyListener } from "../../../client/listener/types.js";
import { type DeploymentDocument, DeploymentStatus, DeploymentStrategy, TaskType } from "../../../types/index.js";

/**
 * Listener that triggers when a deployment's active revision is updated.
 * It schedules both a STOP task for the current active revision and a LIST task
 * for the new active revision, taking into account the deployment strategy.
 */
export const deploymentRevisionUpdate: StrategyListener<DeploymentDocument> = [
  "update",
  ({ id, active_revision, schedule, strategy, status }, db) => {
    scheduleTask(db, TaskType.STOP, id, status, new Date(), { active_revision });
    scheduleTask(db, TaskType.LIST, id, status, strategy === DeploymentStrategy.SCHEDULED
      ? getNextTaskTime(schedule)
      : undefined, { active_revision });
  },
  {
    fields: ["active_revision"],
    filters: {
      status: { $ne: DeploymentStatus.DRAFT },
    }
  }
];