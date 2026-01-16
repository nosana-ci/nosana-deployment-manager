import { describe } from 'vitest';

describe('Simple-Extend Strategy Scenarios', async () => {
  await import('./simple-extend/basic-flow.test.js');
  await import('./simple-extend/finish-before-extend.test.js');
  await import('./simple-extend/queued-without-host.test.js');
  await import('./simple-extend/queue-then-join.test.js');
});
