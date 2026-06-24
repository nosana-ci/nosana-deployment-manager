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
    // A batch no-op (the job was already settled when the stop ran) carries no tx.
    message: tx ? `Successfully stopped job ${job}. TX ${tx}` : `Job ${job} was already settled`,
    tx,
    created_at: new Date(),
  });
}
