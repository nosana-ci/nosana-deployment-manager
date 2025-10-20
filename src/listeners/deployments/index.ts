import { Db } from "mongodb";

import {
  createCollectionListener,
  CollectionListener,
} from "../../client/listener/index.js";
import { getNextTaskTime } from "../../tasks/utils/index.js";
import { scheduleTask } from "../../tasks/scheduleTask.js";

import {
  DeploymentDocument,
  DeploymentStatus,
  DeploymentStrategy,
  TaskType,
} from "../../types/index.js";
import { updateScheduledTasks } from "../../tasks/updateScheduledTasks.js";

export function startDeploymentListener(db: Db) {
  const listener: CollectionListener<DeploymentDocument> =
    createCollectionListener("deployments", db);

  if (!listener) {
    throw new Error("Listener setup is required before starting the service.");
  }

  listener.addListener(
    "update",
    ({ id, strategy, schedule, status }) => {
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
        status: { $eq: DeploymentStatus.STARTING },
      }
    }
  );

  listener.addListener(
    "update",
    ({ id, status }) => {
      scheduleTask(db, TaskType.STOP, id, status)
    },
    {
      fields: ["status"],
      filters: {
        status: { $eq: DeploymentStatus.STOPPING },
      }
    }
  );

  listener.addListener(
    "update",
    ({ id, schedule }) => {
      updateScheduledTasks(db, id, getNextTaskTime(schedule!));
    },
    {
      fields: ["schedule"],
      filters: {
        status: { $ne: DeploymentStatus.DRAFT },
      }
    }
  );

  listener.addListener(
    "update",
    ({ id, active_revision, schedule, strategy, status }) => {
      scheduleTask(db, TaskType.STOP, id, status, new Date(), active_revision);
      scheduleTask(db, TaskType.LIST, id, status, strategy === DeploymentStrategy.SCHEDULED
        ? getNextTaskTime(schedule)
        : undefined, active_revision);
    },
    {
      fields: ["active_revision"],
      filters: {
        status: { $ne: DeploymentStatus.DRAFT },
      }
    }
  );

  listener.start();
}
