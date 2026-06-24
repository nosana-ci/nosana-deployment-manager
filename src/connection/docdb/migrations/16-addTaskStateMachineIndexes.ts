import { Db } from "mongodb";

import { NosanaCollections } from "../../../definitions/collection.js";
import { TaskDocument, TaskStatus } from "../../../types/index.js";

/**
 * Migration for the Phase 1 task-queue state machine.
 *
 * - Backfills `status: PENDING` / `attempts: 0` on any pre-existing task docs so
 *   the new atomic claim (which filters on `status`) can pick them up.
 * - Adds the claim index `{ status, due_at }` (the hot path for fetching the
 *   next claimable task) and `{ deploymentId, status }` (per-deployment
 *   serialization lookups).
 */
export default async function addTaskStateMachineIndexes(db: Db) {
  console.log("Adding task state-machine fields and indexes...");

  const tasks = db.collection<TaskDocument>(NosanaCollections.TASKS);

  await tasks.updateMany(
    { status: { $exists: false } },
    { $set: { status: TaskStatus.PENDING, attempts: 0 } }
  );

  await tasks.createIndex(
    { status: 1, due_at: 1 },
    { name: "idx_status_dueAt" }
  );

  await tasks.createIndex(
    { deploymentId: 1, status: 1 },
    { name: "idx_deploymentId_status" }
  );

  console.log("Task state-machine fields and indexes added successfully.");
}
