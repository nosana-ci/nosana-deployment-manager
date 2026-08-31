import {
  DeploymentsRepository,
  FrpsEndpointStatusRepository,
  JobsRepository,
} from "../repositories/index.js";

import { JobState } from "../types/index.js";

/**
 * The `opId`s a deployment answers on right now, computed from source: a tunnel
 * FRPS has seen come up, on a job that is still RUNNING on chain.
 *
 * Both halves are needed. `frps_endpoint_status` rows are never removed — an FRPS
 * outage longer than its 24h event retention can leave a row reading `up` for a
 * job that is long gone — so the on-chain job state is what retires an endpoint.
 * Equally, a RUNNING job says nothing on its own about whether its service is
 * reachable, which is the whole point of the FRPS half.
 *
 * Only RUNNING jobs count: a QUEUED job has no node and therefore no tunnel.
 *
 * Intersected in memory from two plain queries rather than joined — DocumentDB
 * has no pipeline `$lookup`, and both queries are index-backed.
 */
async function computeOnlineOpIds(deploymentId: string): Promise<Set<string>> {
  const [running, up] = await Promise.all([
    JobsRepository.findAll(
      { deployment: deploymentId, state: JobState.RUNNING },
      { projection: { job: 1 } }
    ),
    FrpsEndpointStatusRepository.findAll({ deploymentId, state: "up" }),
  ]);

  const runningJobs = new Set(running.map(({ job }) => job));

  return new Set(up.filter(({ job }) => runningJobs.has(job)).map(({ opId }) => opId));
}

/**
 * Recompute a deployment's endpoint reachability and write what changed onto its
 * `endpoints`.
 *
 * Called from the listeners that see the three things which move it: a tunnel
 * registering, a tunnel dropping, and a job entering or leaving RUNNING. It
 * recomputes from source rather than toggling the stored value, so a trigger
 * that is missed — a listener restart, an FRPS event that never arrived — is
 * corrected by the next one instead of persisting a wrong answer.
 *
 * Writes through `arrayFilters`, one update per changed `opId`, rather than
 * `$set`ting the whole array: only the entries that actually moved are touched,
 * so a concurrent write to the deployment cannot be clobbered by a stale copy of
 * the array read moments earlier. The filter matches on `opId`, so an op exposing
 * several ports has all of its entries updated together — which is correct, they
 * share one tunnel.
 *
 * `updated_at` is deliberately NOT bumped. It marks configuration changes, and
 * `infiniteJobStateCompletedOrStopUpdate` selects recent jobs with
 * `created_at >= deployment.updated_at` — a tunnel flap moving it would quietly
 * break the rapid-completion fail-safe.
 */
export async function refreshDeploymentEndpointStatus(deploymentId: string): Promise<void> {
  const deployment = await DeploymentsRepository.findOne({ id: deploymentId });
  if (!deployment?.endpoints.length) return;

  const online = await computeOnlineOpIds(deploymentId);

  // One entry per (opId, port), so several can share an opId; dedupe to one
  // update per tunnel.
  const changed = new Map<string, boolean>();
  for (const endpoint of deployment.endpoints) {
    const isOnline = online.has(endpoint.opId);
    if (endpoint.online !== isOnline) changed.set(endpoint.opId, isOnline);
  }

  if (changed.size === 0) return;

  await Promise.all(
    [...changed].map(([opId, isOnline]) =>
      DeploymentsRepository.collection.updateOne(
        { id: deploymentId },
        { $set: { "endpoints.$[endpoint].online": isOnline } },
        { arrayFilters: [{ "endpoint.opId": opId }] }
      )
    )
  );
}

