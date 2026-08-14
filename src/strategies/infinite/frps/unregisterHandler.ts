import type { Db } from "mongodb";

import { getConfig } from "../../../config/index.js";
import { scheduleTask } from "../../../tasks/scheduleTask.js";
import { getFrpsMetrics } from "../../../metrics/frps.js";
import { DeploymentsRepository, EventsRepository, JobsRepository } from "../../../repositories/index.js";
import { isActiveInfiniteDeployment } from "../utils/isActiveInfiniteDeployment.js";

import { parseFrpsMetadata } from "./parseMetadata.js";
import { recordEndpointState } from "./endpointStatus.js";

import { FRPSCloseReasons, type UnregisteredEvent } from "../../../listeners/frps/types.js";
import { EventType, JobState, TaskType } from "../../../types/index.js";

const LOG = "[FRPS unregister]";

/** Job states worth stopping — a settled job has nothing left to stop. */
const STOPPABLE_STATES: JobState[] = [JobState.QUEUED, JobState.RUNNING];

/**
 * Handles a proxy dropping off FRPS: the job's tunnel may be gone, so the
 * workload could be unreachable even though it is still RUNNING on-chain.
 *
 * The op-level status is recorded for every teardown (for observability), but
 * only `lost` triggers a stop — the workload is unreachable, whether the node
 * died or (per FRPS's collapsing) its backend failed a health check. `graceful`
 * is ignored: a job's ops each run their own frpc container, so when one op
 * finishes the node stops it and its proxies go away legitimately, mid-job,
 * while the next op pulls its image. Treating that as a failure would kill
 * healthy multi-op jobs at each transition.
 *
 * A missing `reason` means FRPS predates the distinction, so the event carries no
 * usable fault signal and no stop is scheduled.
 *
 * Schedules a STOP `frps_unhealthy_grace_ms` in the future rather than
 * immediately. A matching `registered` event within that window deletes the task
 * again (see `registerHandler`), so a brief frpc reconnect doesn't kill a healthy
 * job. Putting the grace in the task rather than an in-memory timer means a
 * listener restart mid-window still stops the job. The grace + cancel is the
 * sole reconnect defence — there is deliberately no query back to FRPS.
 *
 * Redeployment is left to `infiniteJobStateCompletedOrStopUpdate`, which already
 * tops the deployment back up when a job reaches STOPPED.
 */
export async function frpsUnregisterHandler(
  { metadatas, proxyName, reason }: UnregisteredEvent,
  db: Db
): Promise<void> {
  const metrics = getFrpsMetrics();
  const { deploymentId, jobId, opId } = parseFrpsMetadata(metadatas);

  // Record the tunnel as down regardless of reason — the dashboard wants to see
  // graceful teardowns too. Needs both keys to identify the endpoint.
  if (jobId && opId) {
    await recordEndpointState({ job: jobId, opId, deploymentId, state: "down", reason });
  }

  const skip = (why: string, detail?: unknown) => {
    console.log(`${LOG} skipping ${proxyName}: ${why}`, detail ?? "");
    metrics?.recordOutcome("skipped");
  };

  if (reason !== FRPSCloseReasons.LOST) {
    // A clean shutdown (an op finishing), or an FRPS too old to say. Either way
    // there is no evidence of a fault here.
    metrics?.recordOutcome("stale_event");
    return;
  }

  if (!deploymentId || !jobId) {
    return skip("event carried no deploymentId/jobId metadata", metadatas);
  }

  const deployment = await DeploymentsRepository.findOne({ id: deploymentId });

  if (!deployment || !isActiveInfiniteDeployment(deployment)) {
    return skip("not a running infinite deployment", deploymentId);
  }

  const job = await JobsRepository.findOne({ job: jobId, deployment: deploymentId });

  if (!job) {
    return skip("job not found", jobId);
  }

  if (!STOPPABLE_STATES.includes(job.state)) {
    return skip(`job is already ${job.state}`, jobId);
  }

  const graceMs = getConfig().frps_unhealthy_grace_ms;
  const due_at = new Date(Date.now() + graceMs);

  // `idempotent` collapses a burst of unregister events for the same job — one
  // per exposed port — into a single STOP task.
  const created = await scheduleTask(
    db,
    TaskType.STOP,
    deployment.id,
    deployment.status,
    due_at,
    { job: jobId, idempotent: true }
  );

  if (!created) {
    return skip("a STOP is already pending for this job", jobId);
  }

  console.log(`${LOG} scheduling stop of ${jobId} at ${due_at.toISOString()}`);
  metrics?.recordOutcome("scheduled");

  await EventsRepository.create({
    category: EventType.DEPLOYMENT,
    deploymentId: deployment.id,
    type: "FRPS_TUNNEL_LOST",
    message: `Job ${jobId} became unreachable and will be stopped and replaced in ${Math.round(graceMs / 1000)}s if it does not recover.`,
    created_at: new Date(),
  });
}
