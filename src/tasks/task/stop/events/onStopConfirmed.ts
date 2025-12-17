import { Collection } from "mongodb";

import {
  EventDocument,
  OutstandingTasksDocument,
} from "../../../../types/index.js";

export function onStopConfirmed(
  job: string,
  tx: string,
  events: Collection<EventDocument>,
  { deploymentId }: OutstandingTasksDocument
) {
  events.insertOne({
    deploymentId,
    category: "Deployment",
    type: "JOB_STOPPED_CONFIRMED",
    message: `Successfully stopped job ${job}. TX ${tx}`,
    created_at: new Date(),
  });
}
