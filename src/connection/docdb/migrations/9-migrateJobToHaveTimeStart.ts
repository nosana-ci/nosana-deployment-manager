import { Db } from "mongodb";

import { NosanaCollections } from "../../../definitions/collection.js";

import type { JobsDocument } from "../../../types/index.js";

export default async function migrateJobsToHaveTimeStart(db: Db) {
  const { acknowledged } = await db.collection<JobsDocument>(NosanaCollections.JOBS).updateMany(
    { time_start: { $exists: false } },
    { $set: { time_start: 0 } }
  );

  if (!acknowledged) {
    throw new Error(`Failed to migrate Jobs to have time_start field`);
  }

}
