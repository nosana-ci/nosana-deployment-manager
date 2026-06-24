import { address } from "@nosana/kit";

import { getKit } from "../../../../kit/index.js";
import { convertJobState } from "../../../../listeners/accounts/helpers/index.js";
import { guardAgainstDefaultNodeAddress } from "../../../../listeners/accounts/handlers/onJobUpdate.js";

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
 *
 * The event is emitted only when the job is *newly* inserted: an idempotent CM
 * replay on reclaim re-confirms the same job, and we must not log (or `tx`-trace)
 * a second JOB_LIST_CONFIRMED for a job that was already recorded.
 */
export async function onListConfirmed(
  jobs: JobsCollection,
  events: EventsCollection,
  task: OutstandingTasksDocument,
  signature: string,
  job: string
) {
  const result = await jobs.updateOne(
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

  if (result.upsertedCount === 0) return; // already recorded — replay, no duplicate event

  // Close the listen-vs-list race: a node can claim this job before the row above
  // was inserted (the LIST confirm poll runs every ~2s, claims are near-instant on
  // a fast chain). That single RUNNING monitor update no-ops against the missing
  // row (`onJobUpdate` uses `upsert:false`) and is lost, stranding the job in
  // QUEUED until the periodic reconcile. Now that the row exists, re-read the
  // merged on-chain state (`get` defaults to `checkRun:true`, so a claimed job
  // reads RUNNING) and apply it. Best-effort: the periodic reconcile is the
  // backstop if this read fails.
  try {
    const onchain = await getKit().jobs.get(address(job));
    const state = convertJobState(onchain.state);
    if (state !== JobState.QUEUED) {
      await jobs.updateOne(
        { job, state: { $nin: [JobState.COMPLETED, JobState.STOPPED] } },
        {
          $set: {
            state,
            time_start: Number(onchain.timeStart),
            node: guardAgainstDefaultNodeAddress(onchain.node),
            updated_at: new Date(),
          },
        }
      );
    }
  } catch {
    /* best-effort reconcile; periodic reconcile catches a missed claim */
  }

  await events.insertOne({
    deploymentId: task.deploymentId,
    category: "Deployment",
    type: "JOB_LIST_CONFIRMED",
    message: `Successfully listed job - ${job}`,
    tx: signature,
    created_at: new Date(),
  });
}
