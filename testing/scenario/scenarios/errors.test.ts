import { describe } from 'vitest';

// Transient task failures (LIST / EXTEND / STOP) now retry with an escalating
// cooldown instead of abandoning the deployment to terminal ERROR. For fast
// targeted runs, start the DM with a small RETRY_COOLDOWN_BASE_MS (e.g. 2000) and
// target a single flow:
//   npm run test:scenarios -- errors list-error
//   npm run test:scenarios -- errors extend-error
//   npm run test:scenarios -- errors stop-error
describe('Error Scenarios', async () => {
  await import('./errors/list-error.test.js');
  await import('./errors/extend-error.test.js');
  await import('./errors/stop-error.test.js');
});
