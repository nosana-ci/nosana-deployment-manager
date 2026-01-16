
import { expect } from 'vitest';
import type { Deployment } from '@nosana/api';
import { address } from '@solana/addresses';

import { State } from '../../utils/index.js';
import { deployerClient } from '../../setup.js';

export function checkJobsTimeout(
  deployment: State<Deployment>,
  job: () => string
) {
  return async () => {
    const { timeout } = deployment.get();
    const onchain = await deployerClient.jobs.get(address(job()));
    const timeoutInSeconds = timeout * 60;
    expect(onchain?.timeout).toBe(timeoutInSeconds * 2);
  };
}