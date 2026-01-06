import { expect } from 'vitest';
import { address, JobState } from '@nosana/kit';

import { vaultClient } from '../../setup.js';

export function stopJob(
  getJobId: () => string
) {
  return async () => {
    let tx = null;
    const job = address(getJobId());
    const { state } = await vaultClient.jobs.get(job);
    if (state === 0) {
      const instruction = await vaultClient.jobs.delist({ job });
      tx = await vaultClient.solana.buildSignAndSend(instruction);
    } else if (state === 1) {
      const instruction = await vaultClient.jobs.end({ job });
      tx = await vaultClient.solana.buildSignAndSend(instruction);
    } else {
      throw new Error(`Job ${job} is in an unstoppable state: ${state}`);
    }

    expect(tx).not.toBeNull();
  };
}