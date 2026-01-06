
import { expect } from 'vitest';
import type { Deployment } from '@nosana/api';
import { address } from '@solana/addresses';

import { State } from '../../utils';
import { deployerClient } from '../../setup';

export function checkJobsTimeout(
  deployment: State<Deployment>,
  job: () => string
) {
  return async () => {
    let { timeout } = deployment.get();

    const onchain = await deployerClient.jobs.get(address(job()));
    expect(onchain?.timeout).toBe(timeout * 2);
  };
}