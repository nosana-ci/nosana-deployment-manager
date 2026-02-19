import { expect } from 'vitest';
import type { Deployment, DeploymentJobItem } from '@nosana/api';

import { deployerClient } from '../../setup.js';
import { State } from '../../utils/index.js';

export function checkDeploymentJobs(
  state: State<Deployment>,
  { expectedJobsCount } = {
    expectedJobsCount: 1
  },
  callback?: (deployment: { id: string; jobs: DeploymentJobItem[] }) => void
) {
  return async () => {
    let jobs: DeploymentJobItem[] = [];
    await expect.poll(
      async () => {
        const deployment = state.get();
        const response = await deployment.getJobs();
        jobs = response.jobs;
        return jobs.length;
      },
      { message: `Waiting for deployment to have ${expectedJobsCount} job(s)` }
    ).toBe(expectedJobsCount);

    callback?.({ ...state.get(), jobs });
  };
}
