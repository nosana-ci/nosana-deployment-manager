import { Db } from "mongodb";

import { DeploymentCollection } from "../../../types/index.js";

export default async function migrateJobsToStatus(db: Db) {
  db.collection<DeploymentCollection>("deployments").updateMany(
    {
      confidential: { $exists: false },
    },
    { $set: { confidential: false } }
  );
}