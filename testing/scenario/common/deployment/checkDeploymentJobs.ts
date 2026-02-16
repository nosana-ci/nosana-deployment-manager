import { expect } from 'vitest';
import type { Deployment, DeploymentJobs } from '@nosana/api';

import { deployerClient } from '../../setup.js';
import { State } from '../../utils/index.js';

export function checkDeploymentJobs(
  state: State<Deployment>,
  { expectedJobsCount } = {
    expectedJobsCount: 1
  },
  callback?: (deployment: { id: string; jobs: DeploymentJobs }) => void
) {
  return async () => {
    let jobs: DeploymentJobs = [];
    await expect.poll(
      async () => {
        const deployment = await deployerClient.api.deployments.get(state.get().id);
        state.set(deployment as Deployment);
        jobs = await deployment.getJobs();
        return jobs.length;
      },
      { message: `Waiting for deployment to have ${expectedJobsCount} job(s)` }
    ).toBe(expectedJobsCount);

    callback?.({ ...state.get(), jobs });
  };
}
