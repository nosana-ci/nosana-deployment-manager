import type { Db } from "mongodb";

import { NosanaCollections } from "../../../definitions/collection.js";
import { DeploymentStatus, JobState } from "../../../types/index.js";
import type { DeploymentDocument, JobsDocument, TaskDocument } from "../../../types/index.js";

/** An INSUFFICIENT_FUNDS deployment untouched this long is not coming back. */
const INSUFFICIENT_FUNDS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A deployment with no queued or running job and no task has nothing running
 * and nothing on the way. RUNNING ones got there when their last job ended
 * before the rotation LIST existed, and no listener will ever revisit them
 * (migration 11 swept the same shape once; the pile grew back, thousands in
 * prod, all months old). INSUFFICIENT_FUNDS ones are kept as the owner-visible
 * reason the deployment ended (`jobAllActiveJobsStop` never flips that status);
 * after a week untouched they are stopped too. STOPPED directly: there is no
 * job to retire, so STOPPING would only queue a STOP task per deployment to
 * find that out.
 */
export default async function stopIdleDeployments(db: Db): Promise<void> {
  const deployments = db.collection<DeploymentDocument>(NosanaCollections.DEPLOYMENTS);
  const [withLiveJobs, withTasks] = await Promise.all([
    db
      .collection<JobsDocument>(NosanaCollections.JOBS)
      .distinct("deployment", { state: { $in: [JobState.QUEUED, JobState.RUNNING] } }),
    db.collection<TaskDocument>(NosanaCollections.TASKS).distinct("deploymentId"),
  ]);

  const idle = { id: { $nin: [...new Set([...withLiveJobs, ...withTasks])] } };
  const stale = new Date(Date.now() - INSUFFICIENT_FUNDS_MAX_AGE_MS);
  const { modifiedCount } = await deployments.updateMany(
    {
      ...idle,
      $or: [
        { status: DeploymentStatus.RUNNING },
        { status: DeploymentStatus.INSUFFICIENT_FUNDS, updated_at: { $lt: stale } },
      ],
    },
    { $set: { status: DeploymentStatus.STOPPED } }
  );
  console.log(`Stopped ${modifiedCount} deployment(s) with no job and no task (RUNNING, or INSUFFICIENT_FUNDS for over a week)`);
}
