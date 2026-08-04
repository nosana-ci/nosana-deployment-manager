import { describe, it, expect } from 'vitest';

import { allJobsRapid } from '../allJobsRapid.js';
import { JobState, type JobsDocument } from '../../../../types/index.js';

// Mainnet defaults: rapid_completion_job_count = 3, threshold = 5 minutes.
const FIVE_MINUTES_S = 5 * 60;

/**
 * A finished job shaped like production docs: `updated_at` equals `created_at`
 * (the finisher paths historically never bumped it), so only the on-chain
 * `time_start`/`time_end` stamps reflect the real run time.
 */
function finishedJob(runtimeSeconds: number, overrides: Partial<JobsDocument> = {}): JobsDocument {
  const createdAt = new Date('2026-08-01T10:31:38Z');
  const timeStart = Math.floor(createdAt.getTime() / 1000) - 3;
  return {
    job: 'job-123',
    market: 'market-123',
    node: 'node-123',
    deployment: 'deployment-123',
    revision: 1,
    tx: 'tx-123',
    state: JobState.COMPLETED,
    time_start: timeStart,
    time_end: timeStart + runtimeSeconds,
    created_at: createdAt,
    updated_at: createdAt,
    ...overrides,
  };
}

describe('allJobsRapid', () => {
  it('is rapid when enough jobs all ran under the threshold on-chain', () => {
    expect(allJobsRapid([finishedJob(30), finishedJob(90), finishedJob(200)])).toBe(true);
  });

  it('is NOT rapid for long-running jobs whose docs were never rewritten after insert (production false trigger)', () => {
    // The old predicate measured `updated_at − time_start` ≈ 3s for these jobs
    // because `updated_at` stayed frozen at the list-confirm — a 5h40m healthy
    // run counted as rapid and tripped the fail-safe.
    const fiveHoursForty = 5 * 3600 + 40 * 60;
    const jobs = [finishedJob(fiveHoursForty), finishedJob(fiveHoursForty), finishedJob(fiveHoursForty)];
    for (const job of jobs) {
      expect(job.updated_at.getTime() - job.time_start * 1000).toBeLessThan(FIVE_MINUTES_S * 1000);
    }
    expect(allJobsRapid(jobs)).toBe(false);
  });

  it('is NOT rapid when any job ran longer than the threshold', () => {
    expect(allJobsRapid([finishedJob(30), finishedJob(FIVE_MINUTES_S + 60), finishedJob(60)])).toBe(false);
  });

  it('is NOT rapid with fewer jobs than the configured count', () => {
    expect(allJobsRapid([finishedJob(30), finishedJob(30)])).toBe(false);
  });

  it('treats a job without an on-chain end stamp as not rapid', () => {
    expect(allJobsRapid([finishedJob(30), finishedJob(30), finishedJob(30, { time_end: undefined })])).toBe(false);
  });

  it('treats a job without an on-chain start stamp as not rapid', () => {
    expect(allJobsRapid([finishedJob(30), finishedJob(30), finishedJob(30, { time_start: 0 })])).toBe(false);
  });

  it('is unaffected by long market queue times before the job started', () => {
    // Queued 10h before a node picked it up: the old predicate measured a large
    // NEGATIVE duration (created_at − time_start) and called it rapid.
    const queued = finishedJob(30, { created_at: new Date('2026-07-31T19:57:05Z'), updated_at: new Date('2026-07-31T19:57:05Z') });
    expect(allJobsRapid([queued, finishedJob(30), finishedJob(30)])).toBe(true);
  });
});
