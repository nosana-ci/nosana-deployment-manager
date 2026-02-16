import { expect } from "vitest";
import { Deployment, NosanaApi } from "@nosana/kit";
import type { DeploymentEvents } from "@nosana/api";

import { State } from "../../utils/index.js";
import { deployerClient } from "../../setup.js";

type Event = DeploymentEvents[number];

export function waitForDeploymentEvent(
  state: State<Deployment>,
  filters: Partial<Event>) {
  return async () => {
    await expect.poll(
      async () => {
        const deployment = await (deployerClient.api as NosanaApi).deployments.get(state.get().id);
        state.set(deployment);
        const events = await deployment.getEvents();
        return events.some((event: Event) =>
          Object.entries(filters).every(([key, value]) => event[key as keyof Event] === value)
        );
      },
      {
        message: `Waiting for deployment to have event matching ${JSON.stringify(filters)}`,
        timeout: 5 * 60_000
      }
    ).toBe(true);
  }
}
