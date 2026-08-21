import { Db } from "mongodb";

import { NosanaCollections } from "../../../definitions/collection.js";
import { FrpsEndpointStatusDocument } from "../../../types/index.js";

/**
 * Indexes for the FRPS endpoint-status collection: a unique key per
 * `(job, opId)` so status upserts can't duplicate a tunnel, and a lookup by
 * deployment for the dashboard.
 */
export default async function addFrpsEndpointStatusIndex(db: Db) {
  console.log("Adding FRPS endpoint-status indexes...");

  const statusCollection = db.collection<FrpsEndpointStatusDocument>(
    NosanaCollections.FRPS_ENDPOINT_STATUS,
  );

  await statusCollection.createIndex(
    { job: 1, opId: 1 },
    { name: "idx_job_opId", unique: true },
  );

  await statusCollection.createIndex(
    { deploymentId: 1 },
    { name: "idx_deploymentId" },
  );
}
