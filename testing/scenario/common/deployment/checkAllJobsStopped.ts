import { expect } from 'vitest';
import type { Deployment, DeploymentJobs } from '@nosana/api';
import { State } from '../../utils/index.js';
import { JobState } from '../../../../src/types/index.js';

type Job = DeploymentJobs[number];

export function checkAllJobsStopped(
  state: State<Deployment>
) {
  return async () => {
    const deployment = state.get();
    const jobs = await deployment.getJobs();
    expect(jobs.every((job: Job) => job.state === JobState.STOPPED || job.state === JobState.COMPLETED)).toBe(true);
  };
}
