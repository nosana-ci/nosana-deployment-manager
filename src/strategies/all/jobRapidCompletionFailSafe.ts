import { findDeployment } from "../utils/shared.js";
import { NosanaCollections } from "../../definitions/collection.js";

import { OnEvent, type StrategyListener } from "../../client/listener/types.js";

import {
  DeploymentDocument,
  DeploymentStatus,
  EventDocument,
  EventType,
  type JobsDocument,
  JobsDocumentFields,
  JobState,
} from "../../types/index.js";

const RAPID_COMPLETION_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const RAPID_COMPLETION_JOB_COUNT = 3;

/**
 * Fail-safe: automatically stops a deployment if the last 3 jobs
 * all completed or stopped in under 5 minutes.
 * This prevents runaway restart loops from burning resources and
 * flooding the markets with many short-lived jobs.
 * It can be triggered by a bad deployment causing rapid failures or completions,
 * or by an external factor causing rapid job terminations.
 */
export const jobRapidCompletionFailSafe: StrategyListener<JobsDocument> = [
  OnEvent.UPDATE,
  /**
   * Fail-safe listener details:
   * - Trigger: fired on job document UPDATE.
   * - Behavior: only runs for deployments in RUNNING state. It considers the last
   *   `RAPID_COMPLETION_JOB_COUNT` jobs that were created since the deployment's
   *   `updated_at` (the time the deployment was started). If all of those jobs
   *   completed/stopped in under `RAPID_COMPLETION_THRESHOLD_MS`, the deployment
   *   is moved to STOPPING and a `RAPID_COMPLETION_FAIL_SAFE` event is emitted.
   * - Rationale: using `deployment.updated_at` prevents immediately re-triggering
   *   the fail-safe after a manual restart (old jobs from a previous lifecycle
   *   are excluded).
   */
  async ({ deployment: jobDeployment }, db) => {
    const deployment = await findDeployment(db, jobDeployment);
    if (!deployment || deployment.status !== DeploymentStatus.RUNNING) return;

    const recentJobs = await db
      .collection<JobsDocument>(NosanaCollections.JOBS)
      .find({
        deployment: jobDeployment,
        state: { $in: [JobState.COMPLETED, JobState.STOPPED] },
        // Consider only jobs created after the deployment was (re)started
        // (`deployment.updated_at`). We use `created_at` (Date) for this
        // lifecycle boundary so restarts reset the fail-safe window.
        created_at: { $gte: deployment.updated_at },
      })
      .sort({ updated_at: -1 })
      .limit(RAPID_COMPLETION_JOB_COUNT)
      .toArray();

    if (recentJobs.length < RAPID_COMPLETION_JOB_COUNT) return;

    const allRapid = recentJobs.every((job) => {
      const duration = job.updated_at.getTime() - job.time_start;
      return duration < RAPID_COMPLETION_THRESHOLD_MS;
    });

    if (!allRapid) return;

    const { acknowledged } = await db
      .collection<DeploymentDocument>(NosanaCollections.DEPLOYMENTS)
      .updateOne(
        {
          id: jobDeployment,
          status: DeploymentStatus.RUNNING,
        },
        { $set: { status: DeploymentStatus.STOPPING } },
      );

    if (!acknowledged) return;

    await db.collection<EventDocument>(NosanaCollections.EVENTS).insertOne({
      category: EventType.DEPLOYMENT,
      deploymentId: jobDeployment,
      type: "RAPID_COMPLETION_FAIL_SAFE",
      message: `Deployment automatically stopped: last ${RAPID_COMPLETION_JOB_COUNT} jobs all completed in under 5 minutes.`,
      created_at: new Date(),
    });
  },
  {
    fields: [JobsDocumentFields.STATE],
    filters: { state: { $in: [JobState.COMPLETED, JobState.STOPPED] } },
  },
];
