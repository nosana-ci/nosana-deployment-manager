import { expect } from 'vitest';
import type { Deployment } from '@nosana/api';
import { State } from '../../utils/index.js';
import { JobState } from '../../../../src/types/index.js';

export function checkAllJobsStopped(
  state: State<Deployment>
) {
  return async () => {
    let deployment = state.get();
    // @ts-expect-error Job state is not yet reflected in kit types
    expect(deployment.jobs.every((job) => job.state === JobState.STOPPED || job.state === JobState.COMPLETED)).toBe(true);
  };
}