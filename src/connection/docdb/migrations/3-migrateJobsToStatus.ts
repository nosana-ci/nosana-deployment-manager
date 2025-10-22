import { Db } from "mongodb";

import { JobsCollection } from "../../../types/index.js";

export default async function migrateJobsToStatus(db: Db) {
  db.collection<JobsCollection>("jobs").updateMany(
    {
      status: { $exists: false },
    },
    { $set: { status: "COMPLETED" } }
  );
}