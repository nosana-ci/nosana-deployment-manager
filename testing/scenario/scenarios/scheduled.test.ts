import { describe } from 'vitest';

describe('Scheduled Strategy Scenarios', async () => {
  await import('./scheduled/basic-flow.test.js');
  await import('./scheduled/multiple-replicas.test.js');
  await import('./scheduled/schedule-repeats.test.js');
  await import('./scheduled/transaction-error.test.js');
});