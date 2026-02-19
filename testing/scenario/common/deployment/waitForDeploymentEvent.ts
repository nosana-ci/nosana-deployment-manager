import { expect } from "vitest";
import { Deployment, NosanaApi } from "@nosana/kit";
import type { DeploymentEventItem } from "@nosana/api";

import { State } from "../../utils/index.js";
import { deployerClient } from "../../setup.js";

export function waitForDeploymentEvent(
  state: State<Deployment>,
  filters: Partial<DeploymentEventItem>) {
  return async () => {
    await expect.poll(
      async () => {
        const deployment = await (deployerClient.api as NosanaApi).deployments.get(state.get().id);
        state.set(deployment);
        const response = await deployment.getEvents();
        return response.events.some((event: DeploymentEventItem) =>
          Object.entries(filters).every(([key, value]) => event[key as keyof DeploymentEventItem] === value)
        );
      },
      {
        message: `Waiting for deployment to have event matching ${JSON.stringify(filters)}`,
        timeout: 5 * 60_000
      }
    ).toBe(true);
  }
}
