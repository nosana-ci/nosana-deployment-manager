import { JobState } from "../../../../types/index.js";
import { OnListEventParams } from "../spawner.js";

export function onListConfirmed(
  tx: string,
  job: string,
  { collections: { events, jobs }, task }: OnListEventParams
) {
  events.insertOne({
    deploymentId: task.deploymentId,
    category: "Deployment",
    type: "JOB_LIST_CONFIRMED",
    message: `Successfully listed job - ${job}`,
    created_at: new Date(),
  });
  jobs.insertOne({
    job,
    tx,
    state: JobState.QUEUED,
    deployment: task.deploymentId,
    revision: task.deployment.active_revision,
    created_at: new Date(),
    updated_at: new Date(),
  });
}
