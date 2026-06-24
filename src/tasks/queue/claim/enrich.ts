import { Collection, ObjectId } from "mongodb";

import { JobState, OutstandingTasksDocument, TaskDocument } from "../../../types/index.js";

/**
 * Hydrate claimed tasks with their deployment, vault, jobs and revisions for
 * the worker. A task whose deployment or vault no longer exists is dropped (it
 * cannot be acted on); it stays PROCESSING until its lease lapses and is then
 * reclaimed, eventually hitting the crash-loop cap.
 */
export async function enrichClaimedTasks(
  collection: Collection<TaskDocument>,
  ids: ObjectId[]
): Promise<OutstandingTasksDocument[]> {
  if (ids.length === 0) return [];

  const results = (await collection
    .aggregate()
    .match({
      _id: { $in: ids },
    })
    .lookup({
      from: "deployments",
      localField: "deploymentId",
      foreignField: "id",
      as: "deployment",
    })
    .lookup({
      from: "jobs",
      localField: "deploymentId",
      foreignField: "deployment",
      as: "jobs",
    })
    .unwind({
      path: "$deployment",
      preserveNullAndEmptyArrays: false,
    })
    .lookup({
      from: "vaults",
      localField: "deployment.vault",
      foreignField: "vault",
      as: "deployment.vault",
    })
    .lookup({
      from: "revisions",
      localField: "deploymentId",
      foreignField: "deployment",
      as: "revisions",
    })
    .unwind({
      path: "$deployment.vault",
      preserveNullAndEmptyArrays: false,
    })
    .toArray()) as OutstandingTasksDocument[];

  // Filter jobs in memory after the aggregation
  return results.map((doc) => ({
    ...doc,
    jobs: doc.jobs.filter((job) => job.state === JobState.QUEUED || job.state === JobState.RUNNING),
  }));
}
