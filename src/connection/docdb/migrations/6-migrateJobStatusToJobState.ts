import type { Db } from "mongodb";

import { NosanaCollections } from "../../../definitions/collection.js";

import { JobState, type JobsDocument } from "../../../types/index.js";

// MIGRATION: Migrate old 'status' field to new 'state' field in Jobs collection
export default async function migrateJobStatusToJobState(db: Db) {
  const jobsCollection = db.collection<JobsDocument & { status: "PENDING" | "CONFIRMED" | "COMPLETED" }>(NosanaCollections.JOBS);
  const now = new Date();

  await Promise.all([
    jobsCollection.updateMany(
      { status: "PENDING" },
      { $set: { state: JobState.QUEUED, updated_at: now }, $unset: { status: "" } }
    ),
    jobsCollection.updateMany(
      { status: "CONFIRMED" },
      { $set: { state: JobState.RUNNING, updated_at: now }, $unset: { status: "" } }
    ),
    jobsCollection.updateMany(
      { status: "COMPLETED" },
      { $set: { state: JobState.COMPLETED, updated_at: now }, $unset: { status: "" } }
    ),
  ]);
}
