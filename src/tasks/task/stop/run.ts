import type { Db } from "mongodb";

import { getConfig } from "../../../config/index.js";
import { VaultWorker } from "../../../worker/Worker.js";
import { getRepository } from "../../../repositories/index.js";
import { scheduleTask } from "../../scheduleTask.js";
import { orchestrateUnits, OrchestrateHandlers } from "../../execution/orchestrate/index.js";
import { selectJobsToStop } from "./selectJobsToStop.js";
import { onStopConfirmed, onStopError, onStopExit } from "./events/index.js";
import {
  RetrySignal,
  applyRetryState,
  clearRetryState,
  retryDelayMs,
  shouldRetry,
} from "../retry/index.js";

import { JobState, TaskType } from "../../../types/index.js";
import type {
  OutstandingTasksDocument,
  TaskRunResult,
  WorkerData,
} from "../../../types/index.js";

export async function runStopTask(
  db: Db,
  task: OutstandingTasksDocument,
  signal: AbortSignal
): Promise<TaskRunResult> {
  const tasks = getRepository("tasks").collection;
  const jobsCollection = getRepository("jobs").collection;
  const deployments = getRepository("deployments").collection;
  const events = getRepository("events").collection;

  // Full-stop housekeeping: drop other pending tasks for this deployment so a
  // stop is not immediately undone by a queued LIST/EXTEND.
  if (!task.limit && !task.job) {
    await tasks.deleteMany({
      deploymentId: task.deploymentId,
      task: { $ne: "STOP" },
      ...(task.active_revision && { active_revision: { $ne: task.active_revision } }),
    });
  }

  const stoppedJobs: string[] = [];
  let retrySignal: RetrySignal | undefined;

  const handlers: OrchestrateHandlers = {
    onConfirmed: (_unit, signature, job) => {
      if (job) {
        stoppedJobs.push(job);
        onStopConfirmed(job, signature, events, task);
      }
    },
    onError: (_unit, error, signature) =>
      onStopError(
        error,
        events,
        task,
        (signal) => {
          retrySignal = signal;
        },
        signature
      ),
  };

  // Freeze the stop-set on the first attempt: the API batch path sends this exact
  // ordered set under one stable idempotency key on every reclaim (a shrinking
  // payload would be PAYLOAD_MISMATCH), and the CM replays its verdict so a job is
  // settled at most once. Already-settled jobs come back as confirmed no-ops, so a
  // job that ends between attempts never fails the batch.
  let stopTargets = task.stop_targets;
  if (stopTargets == null) {
    stopTargets = selectJobsToStop(task.jobs, {
      limit: task.limit,
      activeRevision: task.active_revision,
    }).map(({ job }) => job);
    await tasks.updateOne({ _id: task._id }, { $set: { stop_targets: stopTargets } });
  }

  const worker = new VaultWorker<WorkerData>("../tasks/task/stop/worker.js", {
    workerData: {
      task,
      taskId: task._id.toHexString(),
      vault: task.deployment.vault.vault_key,
      confidential_ipfs_pin: getConfig().confidential_ipfs_pin,
      stopTargets,
    },
  });

  const result = await orchestrateUnits({
    tasks,
    taskId: task._id,
    existing: [],
    worker,
    signal,
    handlers,
  });
  if (result.aborted) return { outcome: "ABORTED", successCount: stoppedJobs.length };
  // A handled stop error reschedules the STOP with an escalating cooldown — the
  // deployment stays STOPPING and keeps retrying the stop, instead of getting
  // stuck in ERROR mid-teardown.
  if (shouldRetry(result, retrySignal)) {
    const delayMs = retryDelayMs(task, result, retrySignal);
    await applyRetryState(deployments, task.deploymentId, retrySignal, delayMs);
    return { outcome: "RETRY", successCount: stoppedJobs.length, retryAfterMs: delayMs };
  }

  // Full-stop self-heal: a LIST already in flight when the stop began can list a
  // job AFTER the stop-set was frozen. That straggler — an active job NOT in the
  // frozen targets — isn't in this batch, so reschedule the stop (idempotently) to
  // sweep it; `jobAllActiveJobsStop` then flips the deployment to STOPPED once the
  // count hits zero. Bounded: the housekeeping + STOPPING status block new LIST
  // tasks, so stragglers come only from already-in-flight lists and drain.
  // Excluding the frozen targets avoids looping on just-stopped jobs whose DB
  // state still lags behind the on-chain settle.
  if (!task.limit && !task.job) {
    const stragglers = await jobsCollection.countDocuments({
      deployment: task.deploymentId,
      state: { $in: [JobState.QUEUED, JobState.RUNNING] },
      job: { $nin: stopTargets },
    });
    if (stragglers > 0) {
      await scheduleTask(db, TaskType.STOP, task.deploymentId, task.deployment.status, new Date(), {
        idempotent: true,
      });
    }
  }

  await onStopExit(stoppedJobs, jobsCollection, task, deployments);
  if ((task.inflight_retries ?? 0) > 0) await clearRetryState(deployments, task.deploymentId);

  return { outcome: "COMPLETED", successCount: stoppedJobs.length };
}
