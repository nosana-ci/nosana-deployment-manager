import { expect } from 'vitest';
import { address } from '@nosana/kit';

import { nodeClient } from '../../setup.js';

export function verifyJobAssignedToNode(
  getJobId: () => string,
  options?: { expectedState?: number }
) {
  return async () => {
    const job = address(getJobId());
    const { state, node } = await nodeClient.jobs.get(job);
    const nodeAddress = nodeClient.wallet!.address.toString();
    
    expect(node).toBe(nodeAddress);
    
    if (options?.expectedState !== undefined) {
      expect(state).toBe(options.expectedState);
    }
  };
}

