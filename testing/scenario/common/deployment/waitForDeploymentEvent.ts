import { expect } from "vitest";
import { Deployment, NosanaApi } from "@nosana/kit";
import type { DeploymentEventItem } from "@nosana/api";

import { State } from "../../utils/index.js";
import { deployerClient } from "../../setup.js";

export function waitForDeploymentEvent(
  state: State<Deployment>,
  filters: Partial<DeploymentEventItem>,
  { atLeast = 1 }: { atLeast?: number } = {}) {
  return async () => {
    await expect.poll(
      async () => {
        const deployment = await (deployerClient.api as NosanaApi).deployments.get(state.get().id);
        state.set(deployment);
        const response = await deployment.getEvents();
        return response.events.filter((event: DeploymentEventItem) =>
          Object.entries(filters).every(([key, value]) => event[key as keyof DeploymentEventItem] === value)
        ).length;
      },
      {
        message: `Waiting for deployment to have ${atLeast} event(s) matching ${JSON.stringify(filters)}`,
        timeout: 5 * 60_000
      }
    ).toBeGreaterThanOrEqual(atLeast);
  }
}
