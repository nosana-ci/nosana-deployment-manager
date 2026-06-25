import { Collection } from "mongodb";

import {
  EventDocument,
  OutstandingTasksDocument,
} from "../../../../types/index.js";
import { classifyTaskError, RetrySignal } from "../../retry/index.js";

export function onExtendError(
  error: string,
  events: Collection<EventDocument>,
  { deploymentId }: OutstandingTasksDocument,
  setRetrySignal: (signal: RetrySignal) => void,
  tx?: string
) {
  events.insertOne({
    deploymentId,
    category: "Deployment",
    type: "JOB_EXTEND_ERROR",
    message: error,
    tx,
    created_at: new Date(),
  });

  setRetrySignal(classifyTaskError(error));
}
