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

      const recentJobs = await JobsRepository.findAll({
        deployment: jobDeployment,
        state: { $in: [JobState.COMPLETED, JobState.STOPPED] },
        created_at: { $gte: deployment.updated_at },
      }, {
        sort: { updated_at: -1 },
        limit: deployment.replicas * rapid_completion_job_count,
      })

      if (allJobsRapid(recentJobs)) {
        const streak = deployment.rapid_streak ?? 0;

        // Ceiling: after enough consecutive rapid rounds, fall back to the
        // original fail-safe and stop the deployment to protect funds. CAS on
        // RUNNING so only one of a burst of completion events wins; once STOPPING
        // the listener early-returns (isActiveInfiniteDeployment requires RUNNING).
        if (rapid_completion_max_streak > 0 && streak + 1 >= rapid_completion_max_streak) {
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

        // Throttle: delay the next replacement round with an escalating cooldown
        // and bump the streak — but only once per round. The idempotent insert
        // dedups the burst of near-simultaneous completion events into one round.
        const delayMs = rapidCompletionCooldownMs(streak);
        const due = new Date(Date.now() + delayMs);
        const created = await scheduleTask(db, TaskType.LIST, deployment.id, deployment.status, due, {
          limit: 1,
          idempotent: true,
        });
        if (created) {
          await DeploymentsRepository.update(
            { id: deployment.id },
            { rapid_streak: streak + 1, next_retry_at: due },
          );
          await EventsRepository.create({
            category: EventType.DEPLOYMENT,
            deploymentId: deployment.id,
            type: "RAPID_COMPLETION_THROTTLE",
            message: `Jobs completing rapidly (round ${streak + 1}): next job throttled by ${Math.round(delayMs / 1000)}s.`,
            created_at: new Date(),
          });
        }
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
