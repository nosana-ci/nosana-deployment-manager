import { address } from "@nosana/kit";

import { getKit } from "../../kit/index.js";
import { scheduleTask } from "../../tasks/scheduleTask.js";
import { JobsRepository, TasksRepository } from "../../repositories/index.js";

import { OnEvent, type StrategyListener } from "../../client/listener/types.js";
import {
  type DeploymentDocument,
  DeploymentDocumentFields,
  DeploymentStatus,
  DeploymentStrategy,
  JobState,
  TaskStatus,
  TaskType,
} from "../../types/index.js";

/**
 * Reacts to a deployment timeout change for the strategies whose RUNNING jobs
 * outlive a single job (INFINITE rotation, SIMPLE-EXTEND extend chain). The
 * update-timeout route only writes the new timeout; this listener — running on
 * the worker — does the reconciliation.
 *
 * For each RUNNING job it works out the job's own delta from its *current
 * on-chain* timeout to the new target (`timeout * 60`), which sidesteps the fact
 * that the change event carries no old value:
 *
 *   - delta > 0 → schedule a one-shot EXTEND that adds exactly the delta (bringing
 *     the job to the new timeout without starting/continuing an extend chain), and
 *     push the job's own pending follow-up (rotation LIST / next EXTEND) forward by
 *     the same delta so the job's deadline and its follow-up stay in lockstep.
 *   - delta <= 0 → skip. On-chain jobs can't be shrunk (the program rejects a
 *     non-greater timeout), so a decrease — or an already-longer SIMPLE-EXTEND job
 *     — is left to finish its current lifetime; new / rotated jobs adopt the new
 *     timeout naturally.
 */
export const deploymentTimeoutUpdate: StrategyListener<DeploymentDocument> = [
  OnEvent.UPDATE,
  async ({ id, status, timeout }, db) => {
    const targetSeconds = timeout * 60;

    const runningJobs = await JobsRepository.findAll({
      deployment: id,
      state: JobState.RUNNING,
    });

    for (const { job } of runningJobs) {
      let currentSeconds: number;
      try {
        const onchain = await getKit().jobs.get(address(job));
        currentSeconds = Number(onchain.timeout);
      } catch {
        // Best-effort: a job we can't read on-chain is skipped; the next natural
        // rotation/extend cycle still adopts the new timeout.
        continue;
      }

      const delta = targetSeconds - currentSeconds;
      if (delta <= 0) continue;

      // Bump this job to the new timeout. `extend_seconds` marks it one-shot so
      // onExtendConfirmed does not (re)start an extend chain.
      await scheduleTask(db, TaskType.EXTEND, id, status, new Date(), {
        job,
        extend_seconds: delta,
      });

      // Push this job's own pending, unsent follow-up forward by the same delta.
      // `extend_seconds: { $exists: false }` excludes the one-shot just scheduled
      // above; only the rotation LIST / chain EXTEND (which have no delta) move.
      const followUps = await TasksRepository.findAll({
        deploymentId: id,
        job,
        status: TaskStatus.PENDING,
        tx: null,
        extend_seconds: { $exists: false },
      });
      if (followUps.length === 0) continue;

      const deltaMs = delta * 1000;
      await TasksRepository.collection.bulkWrite(
        followUps.map((task) => ({
          updateOne: {
            filter: { _id: task._id },
            update: { $set: { due_at: new Date(task.due_at.getTime() + deltaMs) } },
          },
        })),
        { ordered: false },
      );
    }
  },
  {
    fields: [DeploymentDocumentFields.TIMEOUT],
    filters: {
      strategy: {
        $in: [DeploymentStrategy.INFINITE, DeploymentStrategy["SIMPLE-EXTEND"]],
      },
      status: { $eq: DeploymentStatus.RUNNING },
    },
  },
];
