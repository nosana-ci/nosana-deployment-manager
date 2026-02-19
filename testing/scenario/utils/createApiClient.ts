import { vi } from 'vitest';
import { NosanaClient } from '@nosana/kit';
import { createNosanaClient, QueryClient } from '@nosana/api/dist/client/index.js';

export function createApiClient(deployerClient: NosanaClient): QueryClient {
  return createNosanaClient("devnet", {
    identifier: deployerClient.wallet?.address.toString() || '',
    generate: deployerClient.authorization.generate,
    solana: {
      getBalance: vi.fn().mockResolvedValue({ SOL: 100, NOS: 1000 }),
      transferTokensToRecipient: vi.fn().mockResolvedValue(undefined),
      deserializeSignSendAndConfirmTransaction: vi.fn().mockResolvedValue(undefined),
    },
  }, { backend_url: process.env.BACKEND_URL });
}