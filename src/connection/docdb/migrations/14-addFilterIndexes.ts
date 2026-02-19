import { Db } from "mongodb";

import { NosanaCollections } from "../../../definitions/collection.js";
import { DeploymentDocument, EventDocument, JobsDocument, TaskDocument } from "../../../types/index.js";

/**
 * Migration to add compound indexes for filtering capabilities.
 * These indexes optimize queries when using filters like state, category, type, status, etc.
 * Combined with the existing deployment/owner indexes from migration 13.
 */
export default async function addFilterIndexes(db: Db) {
  console.log("Adding filter indexes...");

  const deploymentsCollection = db.collection<DeploymentDocument>(NosanaCollections.DEPLOYMENTS);
  const eventsCollection = db.collection<EventDocument>(NosanaCollections.EVENTS);
  const jobsCollection = db.collection<JobsDocument>(NosanaCollections.JOBS);
  const tasksCollection = db.collection<TaskDocument>(NosanaCollections.TASKS);

  // Jobs collection - add state filter index
  await jobsCollection.createIndex(
    { deployment: 1, state: 1, created_at: -1 },
    { name: "idx_deployment_state_createdAt" }
  );

  // Events collection - add category and type filter indexes
  await eventsCollection.createIndex(
    { deploymentId: 1, category: 1, created_at: -1 },
    { name: "idx_deploymentId_category_createdAt" }
  );

  await eventsCollection.createIndex(
    { deploymentId: 1, type: 1, created_at: -1 },
    { name: "idx_deploymentId_type_createdAt" }
  );

  // Deployments collection - add status and vault filter indexes
  await deploymentsCollection.createIndex(
    { owner: 1, status: 1, created_at: -1 },
    { name: "idx_owner_status_createdAt" }
  );

  await deploymentsCollection.createIndex(
    { owner: 1, vault: 1, created_at: -1 },
    { name: "idx_owner_vault_createdAt" }
  );

  // Tasks collection - add task type filter index
  await tasksCollection.createIndex(
    { deploymentId: 1, task: 1, created_at: -1 },
    { name: "idx_deploymentId_task_createdAt" }
  );

  console.log("Filter indexes added successfully.");
}
