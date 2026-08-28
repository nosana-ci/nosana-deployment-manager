import { describe, it, expect } from 'vitest';

import { selectJobsToStop } from '../selectJobsToStop.js';
import { JobState, type JobsDocument } from '../../../../types/index.js';

const job = (
  id: string,
  state: JobState,
  updatedAtMs: number,
  revision = 1,
): JobsDocument =>
  ({
    job: id,
    deployment: 'deployment-123',
    revision,
    state,
    updated_at: new Date(updatedAtMs),
    created_at: new Date(updatedAtMs),
  } as unknown as JobsDocument);

const ids = (jobs: JobsDocument[]) => jobs.map((j) => j.job);

describe('selectJobsToStop', () => {
  it('prefers QUEUED jobs over RUNNING jobs within the limit', () => {
    const jobs = [
      job('run-old', JobState.RUNNING, 500),
      job('run-older', JobState.RUNNING, 100),
      job('queue-a', JobState.QUEUED, 3000),
      job('queue-b', JobState.QUEUED, 4000),
    ];

    const result = selectJobsToStop(jobs, { limit: 2 });

    expect(ids(result)).toEqual(['queue-a', 'queue-b']);
  });

  it('stops oldest first within the same state', () => {
    const jobs = [
      job('a', JobState.RUNNING, 300),
      job('b', JobState.RUNNING, 100),
      job('c', JobState.RUNNING, 200),
    ];

    const result = selectJobsToStop(jobs, { limit: 2 });

    expect(ids(result)).toEqual(['b', 'c']);
  });

  it('fills remaining capacity with the oldest RUNNING jobs after QUEUED', () => {
    const jobs = [
      job('queue', JobState.QUEUED, 5000),
      job('run-a', JobState.RUNNING, 100),
      job('run-b', JobState.RUNNING, 200),
      job('run-c', JobState.RUNNING, 300),
    ];

    const result = selectJobsToStop(jobs, { limit: 3 });

    expect(ids(result)).toEqual(['queue', 'run-a', 'run-b']);
  });

  describe('targeting one job', () => {
    it('stops only the targeted job, never the deployment\'s other replicas', () => {
      const jobs = [
        job('healthy-a', JobState.RUNNING, 100),
        job('unreachable', JobState.RUNNING, 200),
        job('healthy-b', JobState.RUNNING, 300),
      ];

      // No limit: what a targeted scheduler (lost tunnel, missed startup
      // deadline) sets. Without the target filter this returns all three.
      const result = selectJobsToStop(jobs, { job: 'unreachable' });

      expect(ids(result)).toEqual(['unreachable']);
    });

    it('stops the targeted job even when it is on the active revision', () => {
      const jobs = [job('target', JobState.RUNNING, 100, 2)];

      const result = selectJobsToStop(jobs, { job: 'target', activeRevision: 2 });

      expect(ids(result)).toEqual(['target']);
    });

    it('selects nothing when the targeted job already settled', () => {
      const jobs = [job('other', JobState.RUNNING, 100)];

      const result = selectJobsToStop(jobs, { job: 'gone' });

      expect(result).toEqual([]);
    });
  });

  it('excludes jobs on the active revision', () => {
    const jobs = [
      job('old-queued', JobState.QUEUED, 1000, 1),
      job('active', JobState.QUEUED, 1000, 2),
      job('old-running', JobState.RUNNING, 1000, 1),
    ];

    const result = selectJobsToStop(jobs, { activeRevision: 2 });

    expect(ids(result)).toEqual(['old-queued', 'old-running']);
  });

  it('without a limit returns all jobs, queued-first then oldest', () => {
    const jobs = [
      job('run-new', JobState.RUNNING, 200),
      job('queue-new', JobState.QUEUED, 100),
      job('queue-old', JobState.QUEUED, 50),
      job('run-old', JobState.RUNNING, 10),
    ];

    const result = selectJobsToStop(jobs, {});

    expect(ids(result)).toEqual(['queue-old', 'queue-new', 'run-old', 'run-new']);
  });
});
