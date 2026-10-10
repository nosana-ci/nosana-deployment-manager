import { describe } from 'vitest';

// Every LIST now requests nodes from host-manager (mocked here, see
// mocks/hostManagerMock.ts) and assigns the jobs to them. For a fast run start
// the DM with a short retry cooldown and renewal (missed-webhook needs it):
//   RETRY_COOLDOWN_BASE_MS=2000 RESERVATION_RENEW_MS=10000 docker compose up -d --build
//   npm run test:scenarios -- reservations
describe('Reservation Scenarios', async () => {
  await import('./reservations/no-node-then-join.test.js');
  await import('./reservations/stale-node.test.js');
  await import('./reservations/hold-expires.test.js');
  await import('./reservations/hold-reused.test.js');
  await import('./reservations/host-manager-unavailable.test.js');
  await import('./reservations/terms-changed.test.js');
  await import('./reservations/reservation-rejected.test.js');
  await import('./reservations/cancel-on-stop.test.js');
  await import('./reservations/hold-lapses-before-assign.test.js');
  await import('./reservations/missed-webhook.test.js');
});
