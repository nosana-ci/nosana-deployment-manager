import { describe } from 'vitest';

describe('Simple Strategy Scenarios', async () => {
  await import('./simple/basic-flow.test.js');
  await import('./simple/finish-job-prematurely.test.js');
  await import('./simple/join-queue-before-posted.test.js');
  await import('./simple/multiple-replicas.test.js');
});
