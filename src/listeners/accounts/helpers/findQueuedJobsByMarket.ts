import type { Db } from "mongodb";

import { NosanaCollections } from "../../../definitions/collection.js";
import { type JobsDocument, JobState } from "../../../types/index.js";

export async function findQueuedJobsByMarket(
  db: Db,
  market: string
): Promise<Set<string>> {
  const jobsCollection = db.collection<JobsDocument>(NosanaCollections.JOBS);

  // Find all queued jobs for these deployments
  const queuedJobs = await jobsCollection
    .find({
      market,
      state: JobState.QUEUED,
    })
    .toArray();

  const jobsSet = new Set<string>();

  for (const job of queuedJobs) {
    jobsSet.add(job.job);
  }

  return jobsSet;
}