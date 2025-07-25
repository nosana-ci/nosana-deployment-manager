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
    deployment: task.deploymentId,
    created_at: new Date(),
  });
}
