
import type { Db } from "mongodb";
import type { NosanaClient } from "@nosana/kit";

import { convertJobState } from "./helpers/convertJobState.js";
import { BULK_WRITE_BATCH_SIZE } from "../../connection/index.js";
import { NosanaCollections } from "../../definitions/collection.js";

import { JobState, type JobsDocument } from "../../types/index.js";

export async function updateAllUnfinishedJobs(kit: NosanaClient, db: Db) {
  const now = new Date();
  const jobsCollection = db.collection<JobsDocument>(NosanaCollections.JOBS);

  const jobs = await kit.jobs.all(undefined, true);

  let batch = [];

  for (const job of jobs) {
    const jobAddress = job.address.toString();

    const state = convertJobState(job.state);

    if (state === JobState.QUEUED) continue; // Continuing because job is still QUEUED

    batch.push({
      updateOne: {
        // Same guard as `onJobUpdate`, and for the same reason: `kit.jobs.all()`
        // is a snapshot, so a job that finished between that read and this write
        // would be dragged back to the state it held when the batch was taken.
        filter: {
          job: jobAddress,
          state: { $nin: [JobState.COMPLETED, JobState.STOPPED] },
        },
        update: {
          $set: {
            state,
            time_start: Number(job.timeStart),
            updated_at: now,
            // On-chain timeEnd stays 0 until the job actually ends — leave the
            // doc field absent rather than storing a bogus epoch-0 stamp.
            ...(Number(job.timeEnd) ? { time_end: Number(job.timeEnd) } : {}),
          },
        },
        upsert: false
      }
    });

    if (batch.length === BULK_WRITE_BATCH_SIZE) {
      await jobsCollection.bulkWrite(batch, { ordered: false });
      batch = [];
    }
  }

  if (batch.length > 0) {
    await jobsCollection.bulkWrite(batch, { ordered: false });
  }

  // Schedule next update in 5 minutes
  setTimeout(() => updateAllUnfinishedJobs(kit, db).catch(console.error), 5 * 60 * 1000);
}