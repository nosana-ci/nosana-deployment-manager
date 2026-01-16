
import { expect } from 'vitest';
import type { Deployment, NosanaApi } from '@nosana/api';

import { deployerClient } from '../../setup.js';
import { State } from '../../utils/index.js';

export function checkDeploymentJobs(
  state: State<Deployment>,
  { expectedJobsCount } = {
    expectedJobsCount: 1
  },
  callback?: (deployment: Deployment) => void
) {
  return async () => {
    await expect.poll(
      async () => {
        state.set(await (deployerClient.api as NosanaApi).deployments.get(state.get().id));
        return state.get().jobs.length;
      },
      { message: `Waiting for deployment to have ${expectedJobsCount} job(s)` }
    ).toBe(expectedJobsCount);

    callback?.(state.get());
  };
}

