
import type { Db } from "mongodb";
import type { NosanaClient } from "@nosana/kit";

import { convertJobState } from "./convertJobState.js";
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
        filter: { job: jobAddress },
        update: { $set: { state, time_start: Number(job.timeStart), updated_at: now } },
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