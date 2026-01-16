import type { Db } from "mongodb";

import { NosanaCollections } from "../../../definitions/collection.js";
import { getKit } from "../../../kit/index.js";
import { convertJobState } from "../../../listeners/accounts/helpers/convertJobState.js";

import { JobState, type JobsDocument } from "../../../types/index.js";

// MIGRATION: Migrate old 'status' field to new 'state' field in Jobs collection
export default async function migrateJobStatusToJobState(db: Db) {
  const jobsCollection = db.collection<JobsDocument & { status: "PENDING" | "CONFIRMED" | "COMPLETED" }>(NosanaCollections.JOBS);
  const now = new Date();
  const kit = getKit();

  // First, migrate status to initial state values and remove status field
  await Promise.all([
    jobsCollection.updateMany(
      { status: "PENDING" },
      { $set: { state: JobState.QUEUED, updated_at: now }, $unset: { status: "" } }
    ),
    jobsCollection.updateMany(
      { status: "CONFIRMED" },
      { $set: { state: JobState.RUNNING, updated_at: now }, $unset: { status: "" } }
    ),
    jobsCollection.updateMany(
      { status: "COMPLETED" },
      { $set: { state: JobState.COMPLETED, updated_at: now }, $unset: { status: "" } }
    ),
  ]);

  // Then sync with onchain state for non-completed jobs
  const [jobs, runs] = await Promise.all([kit.jobs.all(), kit.jobs.runs()]);
  const jobStateMap = new Map(jobs.map(job => [job.address.toString(), job.state]));
  const runAccountsSet = new Set(runs.map(run => run.job.toString()));

  const unfinishedJobs = await jobsCollection
    .find({ state: { $nin: [JobState.COMPLETED, JobState.STOPPED] } })
    .toArray();

  const BATCH_SIZE = 999;
  let batch = [];

  for (const { job } of unfinishedJobs) {
    const onchainState = jobStateMap.get(job);

    let state: JobState;
    if (onchainState && onchainState >= 2) {
      state = convertJobState(onchainState);
    } else if (runAccountsSet.has(job)) {
      state = JobState.RUNNING;
    } else if (onchainState === undefined) {
      state = JobState.COMPLETED;
    } else {
      continue; // Keep as QUEUED
    }

    batch.push({
      updateOne: {
        filter: { job },
        update: { $set: { state, updated_at: now } },
      }
    });

    if (batch.length === BATCH_SIZE) {
      await jobsCollection.bulkWrite(batch, { ordered: false });
      batch = [];
    }
  }

  if (batch.length > 0) {
    await jobsCollection.bulkWrite(batch, { ordered: false });
  }
}
