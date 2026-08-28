import type { Db } from "mongodb";

import { scheduleTask } from "../../../tasks/scheduleTask.js";
import { FrpsEndpointStatusRepository, JobsRepository, TasksRepository } from "../../../repositories/index.js";

import { type DeploymentDocument, TaskStatus, TaskType } from "../../../types/index.js";

/**
 * Arms the startup deadline for a job that has just started RUNNING on a node:
 * a STOP scheduled `startup_timeout` minutes out, cancelled by
 * `frpsRegisterHandler` the moment the job's tunnel comes up. A job that never
 * comes online is therefore stopped and — via
 * `infiniteJobStateCompletedOrStopUpdate` — replaced on another node, with no
 * timer and no extra worker: the task's `due_at` IS the deadline, so it survives
 * a listener restart.
 *
 * The deadline starts at RUNNING, which is the earliest signal available, but a
 * node has only claimed the job at that point — the image pull and any ops
 * preceding the exposed one still have to happen inside the window.
 *
 * Ordering closes the race against a tunnel that registers BEFORE the on-chain
 * state reaches RUNNING (frpc is often quicker than the accounts listener). The
 * stop is inserted first and the tunnel state read after: a register that lands
 * before the insert has already written its `up` status, so the read below sees
 * it and disarms; a register that lands after finds the task and deletes it. One
 * of the two always fires, so a job that is already online can never keep an
 * armed stop.
 */
export async function armStartupDeadline(
  db: Db,
  deployment: DeploymentDocument,
  job: string
): Promise<void> {
  const { startup_timeout } = deployment;
  if (!startup_timeout) return;

  // A deployment exposing no ports never registers with FRPS, so every job would
  // miss the deadline and rotate forever. Creation rejects that combination; this
  // guards the case where a later revision drops the last exposed port.
  if (!deployment.endpoints.length) return;

  const due_at = new Date(Date.now() + startup_timeout * 60_000);

  // `idempotent` also means a job already being stopped for another reason (an
  // unhealthy tunnel) is left alone rather than re-labelled a startup failure.
  const created = await scheduleTask(
    db,
    TaskType.STOP,
    deployment.id,
    deployment.status,
    due_at,
    { job, idempotent: true }
  );

  if (!created) return;

  await JobsRepository.collection.updateOne(
    { job, deployment: deployment.id },
    { $set: { startup_deadline: due_at } }
  );

  const online = await FrpsEndpointStatusRepository.findOne({ job, state: "up" });
  if (!online) return;

  await disarmStartupDeadline(deployment.id, job);
}

/**
 * Cancels an armed startup deadline: deletes the pending STOP and clears the
 * marker off the job, so a later rotation of this (healthy) job is not counted
 * as a startup failure.
 *
 * The delete cannot race the consumer: `claimTasks` only claims tasks whose
 * `due_at` has passed, so `due_at > now` guarantees the task has not been picked
 * up. If the deadline already elapsed the filter doesn't match, and the marker is
 * deliberately LEFT in place: the job is about to be stopped for missing its
 * window, and a tunnel that shows up after the deadline does not undo that — a
 * deployment whose jobs consistently register late still needs to escalate.
 *
 * @returns whether a pending stop was cancelled, and whether it was a startup
 * deadline (vs. the unhealthy-tunnel grace stop, whose caller reports it).
 */
export async function disarmStartupDeadline(
  deploymentId: string,
  job: string
): Promise<{ cancelled: boolean; startup: boolean }> {
  const { deletedCount } = await TasksRepository.collection.deleteOne({
    task: TaskType.STOP,
    deploymentId,
    job,
    status: TaskStatus.PENDING,
    due_at: { $gt: new Date() },
  });

  if (!deletedCount) return { cancelled: false, startup: false };

  // The pre-image tells the caller which kind of stop it just cancelled: only a
  // startup deadline leaves this marker on the job.
  const previous = await JobsRepository.collection.findOneAndUpdate(
    { job, deployment: deploymentId },
    { $unset: { startup_deadline: "" } },
    { returnDocument: "before" }
  );

  return { cancelled: true, startup: !!previous?.startup_deadline };
}
