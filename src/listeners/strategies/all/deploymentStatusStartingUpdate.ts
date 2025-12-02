import { scheduleTask } from "../../../tasks/scheduleTask.js";
import { getNextTaskTime } from "../../../tasks/utils/index.js";

import type { StrategyListener } from "../../../client/listener/types.js";
import { type DeploymentDocument, DeploymentStrategy, TaskType } from "../../../types/index.js";


/**
 * Listener that triggers when a deployment's status is updated to "STARTING".
 * It schedules a LIST task for the deployment, respect to:
 * - If the deployment strategy is SCHEDULED, it calculates the next task time based on the schedule.
 * - For other strategies, it schedules the LIST task immediately.
 */
export const deploymentStatusStartingUpdate: StrategyListener<DeploymentDocument> = [
  "update",
  ({ id, strategy, schedule, status }, db) => {
    scheduleTask(
      db,
      TaskType.LIST,
      id,
      status,
      strategy === DeploymentStrategy.SCHEDULED
        ? getNextTaskTime(schedule)
        : undefined
    )
  },
  {
    fields: ["status"],
    filters: {
      status: { $eq: "STARTING" },
    },
  }
];