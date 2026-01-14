import { expect } from 'vitest';
import { address } from '@nosana/kit';

import { nodeClient } from '../../setup.js';

export function finishJob(
  getJobId: () => string
) {
  return async () => {
    const job = address(getJobId());
    const { state, node } = await nodeClient.jobs.get(job);

    if (state !== 1 || node !== nodeClient.wallet!.address.toString()) {
      throw new Error(`Job ${job} is in an unstoppable state: ${state}, or not assigned to this node: ${node}`);
    }

    const instruction = await nodeClient.jobs.finish({
      job,
      ipfsResultsHash: 'QmV2iq3gexzSwPAbhBAPVDip7Pu6k7whECUa4wzUjnPtdA'
    });
    const tx = await nodeClient.solana.buildSignAndSend(instruction);

    expect(tx).not.toBeNull();
  };
}