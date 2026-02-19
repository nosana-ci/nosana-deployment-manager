import { expect } from 'vitest';
import type { Deployment, DeploymentTasks } from '@nosana/api';

import { State } from '../../utils/createState.js';

type Task = DeploymentTasks['tasks'][number];

export function checkNoDeploymentExtendTask(
  state: State<Deployment>,
  { job: expectedJob }: { job: State<string> }
) {
  return async () => {
    const deployment = state.get();

    const response = await deployment.getTasks();
    const hasExtendTask = response.tasks.some(({ job }) => {
      return job === expectedJob.get();
    });

    expect(hasExtendTask).toBe(false);
  };
}
