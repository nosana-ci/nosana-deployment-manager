import { getFrpsMetrics } from "../../../metrics/frps.js";
import { EventsRepository } from "../../../repositories/index.js";

import { parseFrpsMetadata } from "./parseMetadata.js";
import { recordEndpointState } from "./endpointStatus.js";
import { disarmStartupDeadline } from "../utils/armStartupDeadline.js";
import { refreshDeploymentEndpointStatus } from "../../../endpoints/deploymentEndpointStatus.js";

import type { RegisteredEvent } from "../../../listeners/frps/types.js";
import { EventType } from "../../../types/index.js";

const LOG = "[FRPS register]";

/**
 * Handles a proxy coming up on FRPS: cancels the pending STOP for that job, which
 * is either the grace-window stop `frpsUnregisterHandler` scheduled for a lost
 * tunnel, or the startup deadline `armStartupDeadline` armed when the job started
 * running. A registered proxy retires both — the job is reachable.
 *
 * Only the tunnel-recovery case is reported: a job coming online inside its
 * startup window is the ordinary outcome on every job start, and logging it would
 * say nothing an operator needs. `disarmStartupDeadline` tells the two apart.
 *
 * Matching on `job` is unambiguous: the two targeted schedulers above are the only
 * ones that set `job` on a STOP, they cannot both have one pending (the schedule
 * is idempotent per job), and every other STOP is scheduled `due_at = now`.
 *
 * Known limitation: a job exposing several ports has one proxy per port, all
 * carrying the same `jobId`. Cancellation is per-job, not per-proxy, so if one
 * proxy reconnects while another stays down the stop is cancelled and the job
 * keeps running half-reachable. frpc registers a job's proxies over a single
 * control connection, so they normally come and go together; tracking each proxy
 * separately would need durable per-(job, proxy) state, which isn't worth it
 * until we see this happen.
 */
export async function frpsRegisterHandler({ metadatas }: RegisteredEvent): Promise<void> {
  const { deploymentId, jobId, opId } = parseFrpsMetadata(metadatas);

  if (jobId && opId) {
    await recordEndpointState({ job: jobId, opId, deploymentId, state: "up" });
  }

  if (!deploymentId || !jobId) {
    return;
  }

  // The deployment now answers on this op, if the job backing it is RUNNING.
  await refreshDeploymentEndpointStatus(deploymentId);

  const { cancelled, startup } = await disarmStartupDeadline(deploymentId, jobId);

  if (!cancelled || startup) return;

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
