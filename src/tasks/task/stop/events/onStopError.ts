import { Collection } from "mongodb";

import {
  EventDocument,
  OutstandingTasksDocument,
} from "../../../../types/index.js";
import { classifyTaskError, RetrySignal } from "../../retry/index.js";

export function onStopError(
  error: string,
  collection: Collection<EventDocument>,
  { deploymentId }: OutstandingTasksDocument,
  setRetrySignal: (signal: RetrySignal) => void,
  tx?: string
) {
  collection.insertOne({
    deploymentId,
    category: "Deployment",
    type: "JOB_STOP_ERROR",
    message: error,
    tx,
    created_at: new Date(),
  });

  setRetrySignal(classifyTaskError(error));
}
