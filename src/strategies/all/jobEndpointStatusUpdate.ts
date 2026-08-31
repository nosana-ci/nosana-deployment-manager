import { refreshDeploymentEndpointStatus } from "../../endpoints/deploymentEndpointStatus.js";

import { OnEvent, type StrategyListener } from "../../client/listener/types.js";

import { type JobsDocument, JobsDocumentFields } from "../../types/index.js";

/**
 * Keeps a deployment's endpoint reachability honest as its jobs come and go.
 *
 * The FRPS handlers cover a tunnel appearing or dropping, but not every change
 * arrives that way: `frps_endpoint_status` rows are never deleted, so a job that
 * ends without FRPS saying so leaves a row reading `up` behind it. Leaving the
 * deployment lit in that case is the failure this exists to prevent — the job
 * leaving RUNNING is the evidence that retires the endpoint.
 *
 * It also covers the opposite order: frpc often registers a tunnel before the
 * accounts listener has written RUNNING, so the refresh the register handler ran
 * saw no RUNNING job and stored nothing. This one, on the state write itself,
 * settles it.
 *
 * Every strategy, not just INFINITE: any deployment can expose an endpoint. The
 * refresh recomputes from source, so running it on a job change that turns out
 * to move nothing writes nothing.
 */
export const jobEndpointStatusUpdate: StrategyListener<JobsDocument> = [
  OnEvent.UPDATE,
  async ({ deployment }) => {
    await refreshDeploymentEndpointStatus(deployment);
  },
  {
    fields: [JobsDocumentFields.STATE],
  },
];
