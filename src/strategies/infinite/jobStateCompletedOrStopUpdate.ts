import { findDeployment } from "../utils/shared.js";
import { scheduleTask } from "../../tasks/scheduleTask.js";
import { rapidCompletionCooldownMs } from "../../tasks/utils/index.js";

import { OnEvent, type StrategyListener } from "../../client/listener/types.js";
import { isActiveInfiniteDeployment } from "./utils/isActiveInfiniteDeployment.js";

import {
  DeploymentStatus,
  EventType,
  type JobsDocument,
  JobsDocumentFields,
  JobState,
  TaskType,
} from "../../types/index.js";
import { DeploymentsRepository, EventsRepository, JobsRepository, withTransaction } from "../../repositories/index.js";
import { allJobsRapid } from "./utils/allJobsRapid.js";
import { getConfig } from "../../config/index.js";
/**
 * Listener triggered when an infinite deployment job completes or stops.
 * Rapid-completion fail-safe (jobs all finishing under the threshold): instead of
 * stopping immediately, THROTTLE the next replacement round with an escalating
 * cooldown so the deployment keeps RUNNING but backs off its post rate. Only after
 * `rapid_completion_max_streak` consecutive rapid rounds is it stopped, to protect
 * funds. A healthy (non-rapid) job resets the streak. Otherwise schedules a
 * replacement LIST if replicas are under-provisioned.
 */
export const infiniteJobStateCompletedOrStopUpdate: StrategyListener<JobsDocument> =
  [
    OnEvent.UPDATE,
    async ({ deployment: jobDeployment }, db) => {
      const {
        rapid_completion_job_count,
        rapid_completion_threshold_minutes,
        rapid_completion_max_streak,
      } = getConfig();
      const deployment = await findDeployment(db, jobDeployment);
      if (!deployment || !isActiveInfiniteDeployment(deployment)) return;

      // Only COMPLETED jobs feed the rapid heuristic: a STOPPED job is a
      // deployment-initiated action (rotation, revision replacement, scale-down,
      // manual stop) that is short-lived by design and says nothing about
      // workload health.
      const recentJobs = await JobsRepository.findAll({
        deployment: jobDeployment,
        state: JobState.COMPLETED,
        created_at: { $gte: deployment.updated_at },
      }, {
        sort: { updated_at: -1 },
        limit: deployment.replicas * rapid_completion_job_count,
      })

      if (allJobsRapid(recentJobs)) {
        const streak = deployment.rapid_streak ?? 0;

        // One round per throttled LIST: the idempotent insert is the round
        // token, so a burst of duplicate completion events collapses into the
        // one that wins it. Everything below — the streak bump AND the
        // fail-safe ceiling — is gated on winning; a duplicate re-reading the
        // already-bumped streak can no longer re-count the same round and jump
        // straight to the stop.
        const delayMs = rapidCompletionCooldownMs(streak);
        const due = new Date(Date.now() + delayMs);
        const created = await scheduleTask(db, TaskType.LIST, deployment.id, deployment.status, due, {
          limit: 1,
          idempotent: true,
        });
        if (!created) return;

        const newStreak = streak + 1;

        // Ceiling: after enough consecutive rapid rounds, fall back to the
        // original fail-safe and stop the deployment to protect funds. CAS on
        // RUNNING so only one racer wins; once STOPPING the listener
        // early-returns (isActiveInfiniteDeployment requires RUNNING), and the
        // STOP task's housekeeping sweeps the throttled LIST created above.
        if (rapid_completion_max_streak > 0 && newStreak >= rapid_completion_max_streak) {
          await withTransaction(async (session) => {
            const updated = await DeploymentsRepository.update(
              { id: deployment.id, status: DeploymentStatus.RUNNING },
              { status: DeploymentStatus.STOPPING },
              { session },
            );
            if (!updated) return;

            await EventsRepository.create({
              category: EventType.DEPLOYMENT,
              deploymentId: deployment.id,
              type: "RAPID_COMPLETION_FAIL_SAFE",
              message: `Deployment stopped to protect funds: ${rapid_completion_max_streak} consecutive rounds of jobs completed in under ${rapid_completion_threshold_minutes} minutes.`,
              created_at: new Date(),
            }, { session });
          });
          return;
        }

        await DeploymentsRepository.update(
          { id: deployment.id },
          { rapid_streak: newStreak, next_retry_at: due },
        );
        await EventsRepository.create({
          category: EventType.DEPLOYMENT,
          deploymentId: deployment.id,
          type: "RAPID_COMPLETION_THROTTLE",
          message: `Jobs completing rapidly (round ${newStreak}): next job throttled by ${Math.round(delayMs / 1000)}s.`,
          created_at: new Date(),
        });
        return;
      }

      // Healthy completion: a job ran long enough, so reset the rapid streak and
      // clear the pending-retry stamp before topping up.
      if (deployment.rapid_streak || deployment.next_retry_at) {
        await DeploymentsRepository.collection.updateOne(
          { id: deployment.id },
          { $set: { rapid_streak: 0 }, $unset: { next_retry_at: "" } },
        );
      }

      // --- Schedule replacement job if under-provisioned ---
      const runningJobsCount = await JobsRepository.count({
        deployment: jobDeployment,
        state: { $in: [JobState.QUEUED, JobState.RUNNING] },
      });

      if (runningJobsCount < deployment.replicas) {
        scheduleTask(
          db,
          TaskType.LIST,
          deployment.id,
          deployment.status,
          new Date(),
          { limit: 1 },
        );
      }
    },
    {
      fields: [JobsDocumentFields.STATE],
      filters: { state: { $in: [JobState.COMPLETED, JobState.STOPPED] } },
    },
  ];
