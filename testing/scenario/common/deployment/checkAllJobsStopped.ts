import { expect } from 'vitest';
import type { Deployment, DeploymentJobItem } from '@nosana/api';
import { State } from '../../utils/index.js';
import { JobState } from '../../../../src/types/index.js';

export function checkAllJobsStopped(
  state: State<Deployment>
) {
  return async () => {
    const deployment = state.get();
    const response = await deployment.getJobs();
    const jobs = response.jobs;
    expect(jobs.every((job: DeploymentJobItem) => job.state === JobState.STOPPED || job.state === JobState.COMPLETED)).toBe(true);
  };
}
