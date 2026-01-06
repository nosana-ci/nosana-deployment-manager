import { expect } from 'vitest';
import { address, JobState } from '@nosana/kit';

import { deployerClient } from '../../setup.js';
import { State } from '../../utils/createState.js';

export function waitForJobState(
  state: State<string>,
  { expectedState }: { expectedState: JobState }
) {
  return async () => {
    await expect.poll(
      async () => {
        const job = await deployerClient.jobs.get(address(state.get()));
        return job?.state;
      },
      { message: `Waiting for job to reach ${expectedState} state` }
    ).toBe(expectedState);
  };
}