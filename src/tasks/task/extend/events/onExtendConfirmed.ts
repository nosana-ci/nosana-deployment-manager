import type { Db } from "mongodb";

import { scheduleTask } from "../../../scheduleTask.js";
import { getNextExtendTime } from "../../../utils/index.js";

import { TaskType } from "../../../../types/index.js";
import type { EventsCollection, OutstandingTasksDocument } from "../../../../types/index.js";

export function onExtendConfirmed(
  events: EventsCollection,
  task: OutstandingTasksDocument,
  db: Db,
  signature: string,
  job: string
) {
  events.insertOne({
    deploymentId: task.deploymentId,
    category: "Deployment",
    type: "JOB_EXTEND_SUCCESSFUL",
    message: `Successfully extended job - TX ${signature}`,
    tx: signature,
    created_at: new Date(),
  });

  scheduleTask(
    db,
    TaskType.EXTEND,
    task.deploymentId,
    task.deployment.status,
    getNextExtendTime(task.deployment.timeout, false),
    { job }
  );
}
