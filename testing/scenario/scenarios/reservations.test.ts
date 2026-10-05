import { describe } from 'vitest';

// Every LIST now reserves nodes from host-manager (mocked here, see
// host-manager-mock.mjs) and assigns the jobs to them. For a fast run start the
// DM with a short retry cooldown:
//   RETRY_COOLDOWN_BASE_MS=2000 docker compose up -d --build
//   npm run test:scenarios -- reservations
describe('Reservation Scenarios', async () => {
  await import('./reservations/no-node-then-join.test.js');
  await import('./reservations/stale-node.test.js');
  await import('./reservations/hold-expires.test.js');
  await import('./reservations/hold-reused.test.js');
  await import('./reservations/host-manager-unavailable.test.js');
  await import('./reservations/reservation-in-flight.test.js');
  await import('./reservations/reservation-rejected.test.js');
});
