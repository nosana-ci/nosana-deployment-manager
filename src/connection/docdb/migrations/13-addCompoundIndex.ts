import { Db } from "mongodb";

import { NosanaCollections } from "../../../definitions/collection.js";
import { DeploymentDocument, EventDocument, JobsDocument, RevisionDocument } from "../../../types/index.js";

/**
 * Migration to add compound indexes for deployment list queries.
 * These indexes significantly improve query performance, especially for
 * deployments with large amounts of events, jobs, and revisions.
 */
export default async function addCompoundIndexes(db: Db) {
  console.log("Adding compound indexes...");

  const deploymentsCollection = db.collection<DeploymentDocument>(NosanaCollections.DEPLOYMENTS);
  const eventsCollection = db.collection<EventDocument>(NosanaCollections.EVENTS);
  const jobsCollection = db.collection<JobsDocument>(NosanaCollections.JOBS);
  const revisionsCollection = db.collection<RevisionDocument>(NosanaCollections.REVISIONS);

  // Deployment collection indexes
  await deploymentsCollection.createIndex(
    { owner: 1, created_at: -1 },
    { name: "idx_owner_createdAt" }
  );
  await eventsCollection.createIndex(
    { deploymentId: 1, created_at: -1 },
    { name: "idx_deploymentId_createdAt" }
  );

  // Jobs collection compound index for sorted lookups
  await jobsCollection.createIndex(
    { deployment: 1, created_at: -1 },
    { name: "idx_deployment_createdAt" }
  );

  // Revisions collection compound index for sorted lookups
  await revisionsCollection.createIndex(
    { deployment: 1, revision: -1 },
    { name: "idx_deployment_revision_sorted" }
  );

  console.log("Compound indexes added successfully.");
}
