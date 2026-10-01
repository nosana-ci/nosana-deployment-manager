import type { Db } from "mongodb";

/**
 * Deployments created before `requirements` existed have no such field.
 * Responses declare it as required (nullable), so give every document the
 * explicit `null` of a market-mode deployment and the type can stop being
 * optional.
 */
export default async function backfillDeploymentRequirements(db: Db) {
  await db
    .collection("deployments")
    .updateMany({ requirements: { $exists: false } }, { $set: { requirements: null } });
}
