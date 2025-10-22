import { Db } from "mongodb";

import { JobsCollection } from "../../../types/index.js";

export default async function migrateJobsToRevision(db: Db) {
  db.collection<JobsCollection>("jobs").updateMany(
    {
      confidential: { $exists: false },
    },
    { $set: { confidential: false } }
  );
}