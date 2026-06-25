import {
  EventsCollection,
  OutstandingTasksDocument,
} from "../../../../types/index.js";
import { classifyTaskError, RetrySignal } from "../../retry/index.js";

export function onListError(
  events: EventsCollection,
  task: OutstandingTasksDocument,
  error: string,
  setRetrySignal: (signal: RetrySignal) => void,
  tx?: string
) {
  events.insertOne({
    deploymentId: task.deploymentId,
    category: "Deployment",
    type: "JOB_LIST_ERROR",
    message: error,
    tx,
    created_at: new Date(),
  });

  setRetrySignal(classifyTaskError(error));
}
