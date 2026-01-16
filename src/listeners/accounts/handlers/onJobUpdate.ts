import { Db } from "mongodb";
import { Job } from "@nosana/kit";

import { convertJobState } from "../helpers/index.js";
import { NosanaCollections } from "../../../definitions/collection.js";

import { type JobsDocument, JobState } from "../../../types/index.js";

export async function onJobUpdate(
  db: Db,
  jobData: Job
): Promise<void> {
  const jobsCollection = db.collection<JobsDocument>(NosanaCollections.JOBS);
  const { address, state, timeStart } = jobData;

  await jobsCollection.updateOne(
    {
      job: address.toString(),
      state: { $nin: [JobState.COMPLETED, JobState.STOPPED] } // required to ensure states don't regress
    },
    { $set: { state: convertJobState(state), time_start: Number(timeStart) } },
    { upsert: false }
  );
}