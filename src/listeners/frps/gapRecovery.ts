import { fetchLiveProxies } from "../../client/frps/index.js";
import { getFrpsMetrics } from "../../metrics/frps.js";
import { recordEndpointState } from "../../strategies/infinite/frps/endpointStatus.js";

const LOG = "[FRPS gap-recovery]";

/**
 * Re-establishes the tunnel baseline after the event log couldn't be resumed
 * (first connect, a gap too large for the replay ring, or an FRPS restart).
 *
 * Marks every currently-online `(job, opId)` as up and **schedules no stops**.
 * The proxy list is a reason-blind snapshot — it can't tell a graceful teardown
 * from a fault — so it's only ever used to learn what IS up, never to decide what
 * to tear down. Absent endpoints are left as-is; ongoing reason-tagged events
 * drive every stop decision from here.
 */
export async function runGapRecovery(): Promise<void> {
  const live = await fetchLiveProxies();

  if (!live) {
    // Couldn't reach the proxy list; leave the baseline untouched and try again
    // on the next reconnect. Never treat "unreachable" as "nothing is up".
    console.warn(`${LOG} could not fetch the proxy list; baseline left unchanged`);
    return;
  }

  getFrpsMetrics()?.recordGapRecovery();

  let reseeded = 0;
  for (const proxy of live) {
    if (!proxy.opId) continue;
    await recordEndpointState({
      job: proxy.jobId,
      opId: proxy.opId,
      deploymentId: proxy.deploymentId,
      state: "up",
    });
    reseeded++;
  }

  console.log(`${LOG} re-baselined ${reseeded} online endpoint(s)`);
}
