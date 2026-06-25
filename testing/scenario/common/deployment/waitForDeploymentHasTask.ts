import { expect } from "vitest";
import type { Deployment, DeploymentTasks } from "@nosana/api";

import { State } from "../../utils/index.js";
import { TaskType } from "../../../../src/types/index.js";

type Task = DeploymentTasks["tasks"][number];

/**
 * Assert the deployment has at least one (optionally typed) pending task — the
 * signal that a transiently-failed task was rescheduled to retry rather than
 * abandoned. (Contrast with `waitForDeploymentHasNoTasks`, the old terminal
 * behaviour where a failed task was deleted.)
 */
export function waitForDeploymentHasTask(
  state: State<Deployment>,
  { task }: { task?: TaskType } = {},
  callback?: (task: Task) => void,
) {
  return async () => {
    let found: Task | undefined;
    await expect.poll(
      async () => {
        const response = await state.get().getTasks();
        found = response.tasks.find((t) => (task ? t.task === task : true));
        return found !== undefined;
      },
      { message: `Waiting for deployment to have a pending ${task ?? ""} task (retry scheduled)` },
    ).toBe(true);

    callback?.(found!);
  };
}
