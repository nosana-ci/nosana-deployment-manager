import { expect } from 'vitest';
import { address, JobState } from '@nosana/kit';

import { vault } from '../../setup.js';

export function stopJob(
  getJobId: () => string
) {
  return async () => {
    let tx = null;
    const job = address(getJobId());
    const { state } = await vault.jobs.get(job);
    if (state === 0) {
      const instruction = await vault.jobs.delist({ job });
      tx = await vault.solana.buildSignAndSend(instruction);
    } else if (state === 1) {
      const instruction = await vault.jobs.end({ job });
      tx = await vault.solana.buildSignAndSend(instruction);
    } else {
      throw new Error(`Job ${job} is in an unstoppable state: ${state}`);
    }

    expect(tx).not.toBeNull();
  };
}