import { describe } from 'vitest';

// Mechanism B: the rapid-completion fail-safe now THROTTLES the next round (stays
// RUNNING) and only STOPS once the escalating streak hits the ceiling. The two
// flows need different RAPID_COMPLETION_MAX_STREAK, so target them individually:
//
//   # throttle: trips on a single fast job, stays RUNNING (MAX_STREAK default/high)
//   RAPID_COMPLETION_JOB_COUNT=1 RAPID_COMPLETION_COOLDOWN_BASE_MS=2000 docker compose up -d --build
//   npm run test:scenarios -- rapid-completion throttle
//
//   # ceiling: first rapid round hits the ceiling and stops (MAX_STREAK=1)
//   RAPID_COMPLETION_JOB_COUNT=1 RAPID_COMPLETION_MAX_STREAK=1 docker compose up -d --build
//   npm run test:scenarios -- rapid-completion ceiling
//
// The no-flow `rapid-completion` run covers the throttle (the novel behaviour).
describe('Rapid Completion Scenarios', async () => {
  await import('./rapid-completion/throttle.test.js');
});
