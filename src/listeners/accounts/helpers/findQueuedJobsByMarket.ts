import type { Db } from "mongodb";

import { NosanaCollections } from "../../../definitions/collection.js";
import { type JobsDocument, JobState } from "../../../types/index.js";

export async function findQueuedJobsByMarket(
  db: Db,
  market: string
): Promise<Map<string, JobsDocument>> {
  const jobsCollection = db.collection<JobsDocument>(NosanaCollections.JOBS);

  // Find all queued jobs for these deployments
  const queuedJobs = await jobsCollection
    .find({
      market,
      state: JobState.QUEUED,
    })
    .toArray();

  const jobsMap = new Map<string, JobsDocument>();

  for (const job of queuedJobs) {
    jobsMap.set(job.job, job);
  }

  return jobsMap;
}