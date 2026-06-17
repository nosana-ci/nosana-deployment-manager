import {
  JobState,
  JobsCollection,
  EventsCollection,
  OutstandingTasksDocument,
} from "../../../../types/index.js";

/**
 * Records a confirmed LIST unit. The job write is an idempotent `upsert` keyed
 * by the job address, so a duplicate confirm (concurrent reclaim, retry, …) can
 * never create two `jobs` rows for the same on-chain job.
 */
export async function onListConfirmed(
  jobs: JobsCollection,
  events: EventsCollection,
  task: OutstandingTasksDocument,
  signature: string,
  job: string
) {
  await jobs.updateOne(
    { job },
    {
      $setOnInsert: {
        job,
        tx: signature,
        market: task.deployment.market,
        node: null,
        state: JobState.QUEUED,
        deployment: task.deploymentId,
        revision: task.deployment.active_revision,
        time_start: 0,
        created_at: new Date(),
      },
      $set: { updated_at: new Date() },
    },
    { upsert: true }
  );

  await events.insertOne({
    deploymentId: task.deploymentId,
    category: "Deployment",
    type: "JOB_LIST_CONFIRMED",
    message: `Successfully listed job - ${job}`,
    tx: signature,
    created_at: new Date(),
  });
}
