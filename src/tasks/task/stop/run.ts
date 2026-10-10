import type { Db } from "mongodb";

import { VaultWorker } from "../../../worker/Worker.js";
import { getRepository } from "../../../repositories/index.js";
import { scheduleTask } from "../../scheduleTask.js";
import { LIST_IN_FLIGHT } from "../../queue/wanted/index.js";
import { orchestrateUnits, OrchestrateHandlers } from "../../execution/orchestrate/index.js";
import { selectJobsToStop } from "./selectJobsToStop.js";
import { onStopConfirmed, onStopError, onStopExit } from "./events/index.js";
import {
  RetrySignal,
  applyRetryState,
  archiveBannedOwner,
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

  // A STOP without a limit or a job retires a whole scope until it is empty:
  // every active job (a full stop), or every job of another revision (a
  // revision stop, `active_revision` set). A full stop also drops the
  // deployment's other pending tasks so a queued LIST/EXTEND does not undo it,
  // sparing a LIST in flight, which drains to record what landed. A revision
  // stop touches no task: a LIST of a superseded revision is dropped when due.
  const retiresScope = !task.limit && !task.job;
  if (retiresScope && !task.active_revision) {
    await getRepository("tasks").delete({
      deploymentId: task.deploymentId,
      task: { $ne: TaskType.STOP },
      $nor: LIST_IN_FLIGHT,
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
      job: task.job,
    }).map(({ job }) => job);
    await tasks.updateOne({ _id: task._id }, { $set: { stop_targets: stopTargets } });
  }

  const worker = new VaultWorker<WorkerData>("../tasks/task/stop/worker.js", {
    workerData: {
      task,
      taskId: task._id.toHexString(),
      vault: task.deployment.vault.vault_key,
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
  // Negative CM balance = foul-play claw-back: archive the whole owner, don't retry.
  if (retrySignal?.negativeBalance) {
    await archiveBannedOwner(db, task.deployment.owner);
    return { outcome: "FAILED", successCount: stoppedJobs.length };
  }
  // A handled stop error reschedules the STOP with an escalating cooldown — the
  // deployment stays STOPPING and keeps retrying the stop, instead of getting
  // stuck in ERROR mid-teardown.
  if (shouldRetry(result, retrySignal)) {
    const delayMs = retryDelayMs(task, result, retrySignal);
    await applyRetryState(deployments, task.deploymentId, retrySignal, delayMs);
    return { outcome: "RETRY", successCount: stoppedJobs.length, retryAfterMs: delayMs };
  }

  // Self-heal: a LIST already in flight when the stop began can record a job
  // AFTER the stop-set was frozen. That straggler — an active job in this
  // stop's scope NOT in the frozen targets — isn't in this batch, and a LIST
  // still draining may record more; either reschedules the stop (idempotently,
  // once the drain is due) to sweep them. `jobAllActiveJobsStop` then flips a
  // stopping deployment to STOPPED once the count hits zero. Bounded: nothing
  // new is listed once the deployment stops or the revision is superseded, so
  // stragglers come only from lists already in flight. Excluding the frozen
  // targets avoids looping on just-stopped jobs whose DB state still lags
  // behind the on-chain settle. A revision stop's scope is the other
  // revisions, so the new revision's jobs and lists never count.
  if (retiresScope) {
    const otherRevisions = task.active_revision ? { $ne: task.active_revision } : undefined;
    const [stragglers, draining] = await Promise.all([
      jobsCollection.countDocuments({
        deployment: task.deploymentId,
        state: { $in: [JobState.QUEUED, JobState.RUNNING] },
        job: { $nin: stopTargets },
        ...(otherRevisions && { revision: otherRevisions }),
      }),
      tasks.findOne(
        { deploymentId: task.deploymentId, $or: LIST_IN_FLIGHT, ...(otherRevisions && { active_revision: otherRevisions }) },
        { sort: { due_at: 1 }, projection: { due_at: 1 } }
      ),
    ]);
    if (stragglers > 0 || draining) {
      const due = new Date(Math.max(Date.now(), draining?.due_at.getTime() ?? 0));
      await scheduleTask(db, TaskType.STOP, task.deploymentId, task.deployment.status, due, {
        active_revision: task.active_revision || undefined,
        reason: task.active_revision ? "revision" : "stop",
        idempotent: true,
      });
    }
  }

  await onStopExit(stoppedJobs, jobsCollection, task, deployments);
  if ((task.inflight_retries ?? 0) > 0) await clearRetryState(deployments, task.deploymentId);

  return { outcome: "COMPLETED", successCount: stoppedJobs.length };
}
