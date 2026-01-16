import { describe } from 'vitest';

describe('Simple Strategy Scenarios', async () => {
  await import('./scheduled/basic-flow.test.js');
  await import('./scheduled/multiple-replicas.test.js');
});