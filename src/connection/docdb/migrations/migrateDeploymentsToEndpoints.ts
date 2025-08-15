import { Db } from "mongodb";

import { DeploymentCollection } from "../../../types/index.js";

export default async function migrateDeploymentsToEndpoints(db: Db) {
  db.collection<DeploymentCollection>("deployments").updateMany(
    {
      endpoints: { $exists: false },
    },
    { $set: { endpoints: [] } }
  );
}
