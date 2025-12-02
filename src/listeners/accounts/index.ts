
import type { Db } from "mongodb";
import type { NosanaClient } from "@nosana/kit";

import { getKit } from "../../kit/index.js";
import { BULK_WRITE_BATCH_SIZE } from "../../connection/index.js";
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

async function updateAllUnfinishedJobs(kit: NosanaClient, db: Db) {
  const now = new Date();
  const jobsCollection = db.collection<JobsDocument>(NosanaCollections.JOBS);

  const [jobs, runs] = await Promise.all([kit.jobs.all(), kit.jobs.runs()]);
  const runAccountsSet = new Set(runs.map(run => run.job.toString()));

  let batch = [];

  for (const job of jobs) {
    const jobAddress = job.address.toString();

    const state = job.state >= 2
      ? convertJobState(job.state)
      : runAccountsSet.has(jobAddress)
        ? JobState.RUNNING
        : null;

    if (!state) continue; // Continuing because job is still QUEUED

    batch.push({
      updateOne: {
        filter: { job: jobAddress },
        update: { $set: { state, updated_at: now } },
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

export async function startJobAccountsListeners(db: Db) {
  const kit = getKit();
  const jobsCollection = db.collection<JobsDocument>(NosanaCollections.JOBS);

  updateAllUnfinishedJobs(kit, db).catch(console.error);

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