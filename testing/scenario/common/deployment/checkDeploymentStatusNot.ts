import { expect } from "vitest";
import { DeploymentStatus } from "@nosana/kit";
import type { Deployment, NosanaApi } from "@nosana/api";

import { deployerClient } from "../../setup.js";
import { State } from "../../utils/index.js";

/**
 * Assert the deployment's current status is none of `statuses` — used as a
 * regression guard that a transient failure does NOT drive the deployment into a
 * terminal state (e.g. ERROR) it should now retry out of.
 */
export function checkDeploymentStatusNot(
  state: State<Deployment>,
  statuses: DeploymentStatus[],
) {
  return async () => {
    const deployment = await (deployerClient.api as NosanaApi).deployments.get(state.get().id);
    state.set(deployment);
    expect(statuses).not.toContain(deployment.status);
  };
}
