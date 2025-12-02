
import type { Db } from "mongodb";

import { getKit } from "../../kit/index.js";
import { NosanaCollections } from "../../definitions/collection.js";

import { JobState, type JobsDocument } from "../../types/index.js";

function convertJobState(state: number): JobState {
  switch (state) {
    case 0:
      return JobState.QUEUED;
    case 1:
      return JobState.RUNNING;
    case 2:
      return JobState.COMPLETED;
    case 3:
      return JobState.STOPPED;
    default:
      throw new Error(`Unknown job state: ${state}`);
  }
}

export async function startJobAccountsListeners(db: Db) {
  const kit = getKit();
  const jobsCollection = db.collection<JobsDocument>(NosanaCollections.JOBS);

  const stop = await kit.jobs.monitor({
    // Handle job state changes for completed and stopped jobs
    onJobAccount: ({ address, state }) => {
      if (state < 2) return;
      jobsCollection.updateOne(
        { job: address.toString() },
        { $set: { state: convertJobState(state), updated_at: new Date() } },
        { upsert: false }
      );
    },
    // Handle transition to RUNNING state when a run account is created
    onRunAccount: ({ address }) => {
      jobsCollection.updateOne(
        {
          job: address.toString(), state: {
            $nin: [JobState.COMPLETED, JobState.STOPPED]
          }
        },
        { $set: { state: JobState.RUNNING, updated_at: new Date() } },
        { upsert: false }
      );
    }
  });

  process.on('SIGINT', async () => {
    await stop();
    process.exit();
  });
}