import { expect } from "vitest";
import { Deployment, NosanaApi } from "@nosana/kit";

import { State } from "../../utils/index.js";
import { deployerClient } from "../../setup.js";

export function waitForDeploymentEvent(
  state: State<Deployment>,
  filters: Partial<Deployment["events"][0]>) {
  return async () => {
    await expect.poll(
      async () => {
        const deployment = await (deployerClient.api as NosanaApi).deployments.get(state.get().id);
        state.set(deployment);
        return deployment.events.some(event =>
          Object.entries(filters).every(([key, value]) => event[key as keyof typeof event] === value)
        );
      },
      {
        message: `Waiting for deployment to have event matching ${JSON.stringify(filters)}`,
        timeout: 5 * 60_000
      }
    ).toBe(true);
  }
}