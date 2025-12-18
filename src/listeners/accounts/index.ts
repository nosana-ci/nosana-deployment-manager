import type { Db } from "mongodb";

import { getKit } from "../../kit/index.js";
import { convertJobState } from "./convertJobState.js";
import { NosanaCollections } from "../../definitions/collection.js";
import { updateAllUnfinishedJobs } from "./updateAllUnfinishedJobs.js";

import { JobState, type JobsDocument } from "../../types/index.js";

export async function startJobAccountsListeners(db: Db) {
  const kit = getKit();
  const jobsCollection = db.collection<JobsDocument>(NosanaCollections.JOBS);

  updateAllUnfinishedJobs(kit, db).catch(console.error);

  const [stream, stop] = await kit.jobs.monitor();

  process.on('SIGINT', () => {
    stop();
    process.exit();
  });

  for await (const { type, data } of stream) {
    if (type !== "job" || data.state === 0) continue;

    const { address, state, timeStart } = data;

    await jobsCollection.updateOne(
      {
        job: address.toString(),
        time_start: Number(timeStart),
        state: { $nin: [JobState.COMPLETED, JobState.STOPPED] } // required to ensure states don't regress
      },
      { $set: { state: convertJobState(state) } },
      { upsert: false }
    );
  }
}