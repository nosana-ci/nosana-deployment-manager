import { expect } from "vitest";
import { Deployment } from "@nosana/kit";

import { State } from "../../utils/index.js";

export function waitForDeploymentHasNoTasks(
  state: State<Deployment>,
) {
  return async () => {
    await expect.poll(
      async () => {
        const deployment = state.get();
        const response = await deployment.getTasks();
        console.log(`Deployment has ${response.tasks.length} tasks.`, response.tasks);
        expect(response.tasks.length).toBe(0);
      }, { message: `Waiting for deployment to have no tasks` }
    );
  }
}