import { getFrpsMetrics } from "../../../metrics/frps.js";
import { EventsRepository, TasksRepository } from "../../../repositories/index.js";

import { parseFrpsMetadata } from "./parseMetadata.js";
import { recordEndpointState } from "./endpointStatus.js";

import type { RegisteredEvent } from "../../../listeners/frps/types.js";
import { EventType, TaskStatus, TaskType } from "../../../types/index.js";

const LOG = "[FRPS register]";

/**
 * Handles a proxy coming back on FRPS: cancels the STOP that `frpsUnregisterHandler`
 * scheduled, if it is still inside its grace window.
 *
 * The delete cannot race the consumer. `claimTasks` only claims tasks whose
 * `due_at` has passed, so filtering on `due_at > now` guarantees the task has not
 * been picked up; if the grace already elapsed and a consumer claimed it, the
 * filter simply doesn't match and the stop proceeds — the correct outcome, since
 * by then the tunnel was down for the full window.
 *
 * Matching on `job` is unambiguous: no other scheduler sets `job` on a STOP task,
 * and every other STOP is scheduled `due_at = now`.
 *
 * Known limitation: a job exposing several ports has one proxy per port, all
 * carrying the same `jobId`. Cancellation is per-job, not per-proxy, so if one
 * proxy reconnects while another stays down the stop is cancelled and the job
 * keeps running half-reachable. frpc registers a job's proxies over a single
 * control connection, so they normally come and go together; tracking each proxy
 * separately would need durable per-(job, proxy) state, which isn't worth it
 * until we see this happen.
 */
export async function frpsRegisterHandler({ metadatas, proxyName }: RegisteredEvent): Promise<void> {
  const { deploymentId, jobId, opId } = parseFrpsMetadata(metadatas);

  if (jobId && opId) {
    await recordEndpointState({ job: jobId, opId, deploymentId, state: "up" });
  }

  if (!deploymentId || !jobId) {
    console.log(`${LOG} ignoring ${proxyName}: no deploymentId/jobId metadata`, metadatas ?? "");
    return;
  }

  const { deletedCount } = await TasksRepository.collection.deleteOne({
    task: TaskType.STOP,
    deploymentId,
    job: jobId,
    status: TaskStatus.PENDING,
    due_at: { $gt: new Date() },
  });

  if (!deletedCount) return;

  console.log(`${LOG} ${jobId} reconnected within its grace window, cancelling stop`);
  getFrpsMetrics()?.recordOutcome("cancelled");

  await EventsRepository.create({
    category: EventType.DEPLOYMENT,
    deploymentId,
    type: "FRPS_TUNNEL_RECOVERED",
    message: `Job ${jobId} reconnected its network tunnel; the pending stop was cancelled.`,
    created_at: new Date(),
  });
}
