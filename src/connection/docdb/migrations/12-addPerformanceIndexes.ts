import { Db } from "mongodb";

import { NosanaCollections } from "../../../definitions/collection.js";
import { DeploymentDocument, EventDocument, JobsDocument, ResultsDocument, RevisionDocument, TaskDocument, VaultDocument } from "../../../types/index.js";

/**
 * Migration to add performance indexes for deployment queries.
 * These indexes significantly improve query performance, especially for
 * deployments with large amounts of events, jobs, and revisions.
 */
export default async function addPerformanceIndexes(db: Db) {
  console.log("Adding performance indexes...");

  const deploymentsCollection = db.collection<DeploymentDocument>(NosanaCollections.DEPLOYMENTS);
  const eventsCollection = db.collection<EventDocument>(NosanaCollections.EVENTS);
  const jobsCollection = db.collection<JobsDocument>(NosanaCollections.JOBS);
  const tasksCollection = db.collection<TaskDocument>(NosanaCollections.TASKS);
  const revisionsCollection = db.collection<RevisionDocument>(NosanaCollections.REVISIONS);
  const resultsCollection = db.collection<ResultsDocument>(NosanaCollections.RESULTS);
  const vaultsCollection = db.collection<VaultDocument>(NosanaCollections.VAULTS);

  // Deployment collection indexes
  await deploymentsCollection.createIndex(
    { id: 1 },
    { name: "idx_id" }
  );

  await deploymentsCollection.createIndex(
    { id: 1, owner: 1, created_at: -1 },
    { name: "idx_id_owner_createdAt" }
  );

  await deploymentsCollection.createIndex(
    { id: 1, created_at: -1 },
    { name: "idx_id_createdAt" }
  );

  // Job collection indexes
  await jobsCollection.createIndex(
    { job: 1 },
    { name: "idx_job", unique: true }
  );

  await jobsCollection.createIndex(
    { deployment: 1 },
    { name: "idx_deployment" }
  );

  await jobsCollection.createIndex(
    { state: 1, market: 1 },
    { name: "idx_state_market" }
  );

  // Tasks collection indexes
  await tasksCollection.createIndex(
    { due_at: 1 },
    { name: "idx_due_at" }
  );

  await tasksCollection.createIndex(
    { deploymentId: 1, created_at: -1 },
    { name: "idx_deploymentId_createdAt" }
  );

  // Results collection indexes
  await resultsCollection.createIndex(
    { job: 1 },
    { name: "idx_job", unique: true }
  );

  // Vaults collection indexes
  await vaultsCollection.createIndex(
    { owner: 1 },
    { name: "idx_owner" }
  );

  await vaultsCollection.createIndex(
    { vault: 1, owner: 1 },
    { name: "idx_vault_owner", unique: true }
  );

  await vaultsCollection.createIndex(
    { vault: 1 },
    { name: "idx_vault", unique: true }
  );

  // Revisions collection indexes (for $lookup)
  await revisionsCollection.createIndex(
    { deployment: 1 },
    { name: "idx_deployment" }
  );

  await revisionsCollection.createIndex(
    { deployment: 1, revision: 1 },
    { name: "idx_deployment_revision", unique: true }
  );

  // Events collection indexes (for $lookup in fetchDeployments)
  await eventsCollection.createIndex(
    { deploymentId: 1 },
    { name: "idx_deploymentId" }
  );

  console.log("Performance indexes added successfully.");
}
