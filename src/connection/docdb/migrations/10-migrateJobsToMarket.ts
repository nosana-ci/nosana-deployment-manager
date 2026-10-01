import { Db } from "mongodb";

import { DeploymentDocument, JobsDocument } from "../../../types/index.js";
import { NosanaCollections } from "../../../definitions/collection.js";

export default async function migrateJobsToMarket(db: Db) {
  const deploymentsCollection = db.collection<DeploymentDocument>(NosanaCollections.DEPLOYMENTS);
  const jobsCollection = db.collection<JobsDocument>(NosanaCollections.JOBS);

  const deployments = await deploymentsCollection.find().toArray();

  for (const deployment of deployments) {
    if (deployment.market === null) continue; // requirements deployment: its jobs carry their own market

    await jobsCollection.updateMany(
      {
        deployment: deployment.id,
        market: { $exists: false },
      },
      {
        $set: { market: deployment.market },
      }
    );
  }
}