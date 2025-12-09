import type { Db } from "mongodb";

import { scheduleTask } from "../../../scheduleTask.js";
import { getNextExtendTime } from "../../../utils/index.js";

import { TaskType } from "../../../../types/index.js";
import type { EventsCollection, OutstandingTasksDocument } from "../../../../types/index.js";

export function onExtendConfirmed(
  tx: string,
  events: EventsCollection,
  { deploymentId, deployment: { timeout, status } }: OutstandingTasksDocument,
  db: Db
) {
  events.insertOne({
    deploymentId: deploymentId,
    category: "Deployment",
    type: "JOB_EXTEND_SUCCESSFUL",
    message: `Successfully extended job - TX ${tx}`,
    created_at: new Date(),
  });

  scheduleTask(
    db,
    TaskType.EXTEND,
    deploymentId,
    status,
    getNextExtendTime(timeout, false)
  );
}
