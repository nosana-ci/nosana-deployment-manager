
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

export async function startJobListeners(db: Db) {
  const kit = getKit();
  const jobsCollection = db.collection<JobsDocument>(NosanaCollections.JOBS);

  const stop = await kit.jobs.monitor({
    onJobAccount: ({ address, state }) => {
      // The state is set to Queued when the entry is first created
      // The onRunAccount will handle transfer to running state
      if (state >= 2) {
        jobsCollection.updateOne(
          { job: address.toString() },
          { $set: { state: convertJobState(state), updated_at: new Date() } },
          { upsert: false }
        );
      }
    },
    onRunAccount: ({ address }) => {
      jobsCollection.updateOne(
        { job: address.toString() },
        { $set: { state: JobState.RUNNING, updated_at: new Date() } },
        { upsert: false }
      );
    }
  })

  process.on('SIGINT', async () => {
    await stop();
    process.exit();
  });
}