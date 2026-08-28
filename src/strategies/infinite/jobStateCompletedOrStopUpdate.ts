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
 *
 * A job stopped for missing its startup deadline feeds the SAME streak, and is
 * what keeps a startup timeout from rotating nodes forever: a definition that can
 * never come online (wrong port, image that always fails to boot, a timeout set
 * shorter than the image pull) would otherwise burn the vault one replacement at a
 * time. It counts on its own rather than through `allJobsRapid`, which only reads
 * COMPLETED jobs — these are STOPPED, and deliberately excluded there as
 * deployment-initiated. The marker is the evidence: `armStartupDeadline` sets it
 * when the clock starts and `disarmStartupDeadline` clears it the moment the
 * tunnel comes up, so it survives to here only on a job that never came online.
 */
export const infiniteJobStateCompletedOrStopUpdate: StrategyListener<JobsDocument> =
  [
    OnEvent.UPDATE,
    async ({ deployment: jobDeployment, startup_deadline }, db) => {
      const {
        rapid_completion_job_count,
        rapid_completion_threshold_minutes,
        rapid_completion_max_streak,
      } = getConfig();
      const deployment = await findDeployment(db, jobDeployment);
      if (!deployment || !isActiveInfiniteDeployment(deployment)) return;

      // Still armed on a settled job: it was stopped for never opening its tunnel.
      // Counts as a round on its own, so the query below is skipped.
      const startupFailed = !!startup_deadline;

      // Only COMPLETED jobs feed the rapid heuristic: a STOPPED job is a
      // deployment-initiated action (rotation, revision replacement, scale-down,
      // manual stop) that is short-lived by design and says nothing about
      // workload health.
      const recentJobs = startupFailed ? [] : await JobsRepository.findAll({
        deployment: jobDeployment,
        state: JobState.COMPLETED,
        created_at: { $gte: deployment.updated_at },
      }, {
        sort: { updated_at: -1 },
        limit: deployment.replicas * rapid_completion_job_count,
      })

      if (startupFailed || allJobsRapid(recentJobs)) {
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
              type: startupFailed ? "STARTUP_TIMEOUT_FAIL_SAFE" : "RAPID_COMPLETION_FAIL_SAFE",
              message: startupFailed
                ? `Deployment stopped to protect funds: ${rapid_completion_max_streak} consecutive rounds of jobs failing to come online within ${deployment.startup_timeout} minutes of starting.`
                : `Deployment stopped to protect funds: ${rapid_completion_max_streak} consecutive rounds of jobs completed in under ${rapid_completion_threshold_minutes} minutes.`,
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
          type: startupFailed ? "STARTUP_TIMEOUT_THROTTLE" : "RAPID_COMPLETION_THROTTLE",
          message: startupFailed
            ? `Job did not come online within ${deployment.startup_timeout} minutes of starting and was replaced (round ${newStreak}): next job throttled by ${Math.round(delayMs / 1000)}s.`
            : `Jobs completing rapidly (round ${newStreak}): next job throttled by ${Math.round(delayMs / 1000)}s.`,
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
