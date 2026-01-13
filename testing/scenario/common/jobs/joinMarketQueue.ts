import { expect } from 'vitest';
import { address } from '@nosana/kit';

import { deployerClient } from '../../setup.js';

export function joinMarketQueue(
  getMarketAddress: () => string
) {
  return async () => {
    const marketAddress = address(getMarketAddress());

    // Try to join the queue
    const instruction = await deployerClient.jobs.work({
      market: marketAddress,
    });

    try {
      await deployerClient.solana.buildSignAndSend(instruction);
    } catch (error: unknown) {
      // If node is already in queue, that's fine - we can continue
      const err = error as { details?: { cause?: { context?: { code?: number } } }; context?: { logs?: string[] } };
      const errorCode = err?.details?.cause?.context?.code;
      const errorLogs = err?.context?.logs || [];
      const hasNodeAlreadyQueued = errorCode === 6014 || errorLogs.some(log => log.includes('NodeAlreadyQueued'));

      if (!hasNodeAlreadyQueued) {
        // Re-throw if it's a different error
        throw error;
      }
    }

    // Verify the market account is accessible (node should be in queue now)
    const marketAfter = await deployerClient.jobs.market(marketAddress);
    // Verify our node address is in the queue
    const nodeAddress = deployerClient.wallet!.address.toString();
    const queueAddresses = marketAfter.queue.map((addr) => addr.toString());
    expect(queueAddresses).toContain(nodeAddress);
  };
}

