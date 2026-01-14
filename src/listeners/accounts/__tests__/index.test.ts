import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Db } from 'mongodb';
import type { Job, Market, NosanaClient } from '@nosana/kit';
import { MarketQueueType, JobState as KitJobState } from '@nosana/kit';
import { address } from '@solana/addresses';

import { getKit } from '../../../kit/index.js';
import { JobState, type JobsDocument } from '../../../types/index.js';
import { NosanaCollections } from '../../../definitions/collection.js';
import { onMarketUpdate, onJobUpdate } from '../handlers/index.js';
import { findQueuedJobsByMarket } from '../helpers/findQueuedJobsByMarket.js';

// Mock the kit module
vi.mock('../../../kit/index.js', () => ({
  getKit: vi.fn()
}));

// Mock the helper functions
vi.mock('../helpers/findQueuedJobsByMarket.js', () => ({
  findQueuedJobsByMarket: vi.fn()
}));

// Mock console.log to avoid noise in tests
// vi.spyOn(console, 'log').mockImplementation(() => { });

describe('listeners/accounts/index', () => {
  // Constants
  const TIME_START = 1234567890;
  const MARKET_ADDRESS = '55555555555555555555555555555555555555555555';
  const DEPLOYMENT_1 = '11111111111111111111111111111111111111111111';
  const JOB_1 = '33333333333333333333333333333333333333333333';
  const JOB_2 = '44444444444444444444444444444444444444444444';
  const TX_1 = 'tx-1';
  const TX_2 = 'tx-2';
  const NOW = new Date('2025-01-01T00:00:00Z');
  const JOB_NOT_FOUND_ERROR = 'Account does not exist or has no data';

  const mockJobsGet = vi.fn();
  const mockKit = {
    jobs: {
      get: mockJobsGet
    }
  } as unknown as NosanaClient;

  const mockJobsUpdateOne = vi.fn();
  const mockJobsUpdateMany = vi.fn();
  const mockFindQueuedJobsByMarket = vi.mocked(findQueuedJobsByMarket);

  const mockDb = {
    collection: vi.fn((name: string) => {
      if (name === NosanaCollections.JOBS) {
        return {
          updateOne: mockJobsUpdateOne,
          updateMany: mockJobsUpdateMany
        };
      }
      return {};
    })
  } as unknown as Db;

  function createQueuedJob(jobAddress: string, deploymentId: string, tx: string): JobsDocument {
    return {
      job: jobAddress,
      deployment: deploymentId,
      revision: 0,
      market: address(MARKET_ADDRESS),
      tx,
      state: JobState.QUEUED,
      time_start: 0,
      created_at: NOW,
      updated_at: NOW
    };
  }

  function createJobData(state: KitJobState): Job {
    return {
      address: address(JOB_1),
      state,
      timeStart: BigInt(TIME_START)
    } as Job;
  }

  function createMarket(queueType: MarketQueueType, queue: string[] = []): Market {
    return {
      address: address(MARKET_ADDRESS),
      queueType,
      queue: queue.map(addr => address(addr))
    } as unknown as Market;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getKit).mockReturnValue(mockKit);
  });

  describe('onJobUpdate', () => {
    it('should update job state and time_start from on-chain data', async () => {
      await onJobUpdate(mockDb, createJobData(KitJobState.RUNNING));

      expect(mockJobsUpdateOne).toHaveBeenCalledWith(
        expect.objectContaining({ job: JOB_1 }),
        expect.objectContaining({
          $set: expect.objectContaining({
            state: JobState.RUNNING,
            time_start: TIME_START
          })
        }),
        { upsert: false }
      );
    });

    it('should not update jobs that are already completed or stopped', async () => {
      mockJobsUpdateOne.mockResolvedValue({ matchedCount: 0 });

      await onJobUpdate(mockDb, createJobData(KitJobState.COMPLETED));

      expect(mockJobsUpdateOne).toHaveBeenCalled();
    });

    it.each([
      { kitState: KitJobState.RUNNING, expected: JobState.RUNNING },
      { kitState: KitJobState.COMPLETED, expected: JobState.COMPLETED },
      { kitState: KitJobState.STOPPED, expected: JobState.STOPPED }
    ])('should convert $kitState to $expected', async ({ kitState, expected }) => {
      vi.clearAllMocks();

      await onJobUpdate(mockDb, createJobData(kitState));

      expect(mockJobsUpdateOne).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          $set: expect.objectContaining({
            state: expected,
            time_start: TIME_START
          })
        }),
        expect.any(Object)
      );
    });
  });

  describe('onMarketUpdate', () => {
    const setupMarketUpdate = (queuedJobs: JobsDocument[], marketQueue: string[], queueType = MarketQueueType.JOB_QUEUE) => {
      const jobsSet = new Set<string>();
      queuedJobs.forEach(job => jobsSet.add(job.job));
      mockFindQueuedJobsByMarket.mockResolvedValue(jobsSet);
      return createMarket(queueType, marketQueue);
    };

    it('should do nothing when there are no queued jobs', async () => {
      mockFindQueuedJobsByMarket.mockResolvedValue(new Set());
      const marketAccount = createMarket(MarketQueueType.JOB_QUEUE, []);

      await onMarketUpdate(mockDb, marketAccount);

      expect(mockJobsUpdateMany).not.toHaveBeenCalled();
      expect(mockJobsGet).not.toHaveBeenCalled();
    });

    it('should mark delisted jobs as STOPPED', async () => {
      const queuedJobs = [
        createQueuedJob(JOB_1, DEPLOYMENT_1, TX_1),
        createQueuedJob(JOB_2, DEPLOYMENT_1, TX_2)
      ];
      const marketAccount = setupMarketUpdate(queuedJobs, [JOB_1]);
      mockJobsGet.mockRejectedValueOnce(new Error(JOB_NOT_FOUND_ERROR));

      await onMarketUpdate(mockDb, marketAccount);

      expect(mockJobsUpdateMany).toHaveBeenCalledWith(
        { job: { $in: [JOB_2] } },
        { $set: { state: JobState.STOPPED } }
      );
    });

    it('should not update jobs that still exist on-chain', async () => {
      const queuedJobs = [createQueuedJob(JOB_1, DEPLOYMENT_1, TX_1)];
      const marketAccount = setupMarketUpdate(queuedJobs, []);
      mockJobsGet.mockResolvedValue({ address: address(JOB_1) } as Job);

      await onMarketUpdate(mockDb, marketAccount);

      expect(mockJobsGet).toHaveBeenCalledWith(address(JOB_1));
      expect(mockJobsUpdateMany).not.toHaveBeenCalled();
    });

    it('should check all jobs when queue is empty', async () => {
      const queuedJobs = [
        createQueuedJob(JOB_1, DEPLOYMENT_1, TX_1),
        createQueuedJob(JOB_2, DEPLOYMENT_1, TX_2)
      ];
      const marketAccount = setupMarketUpdate(queuedJobs, []);
      mockJobsGet
        .mockRejectedValueOnce(new Error(JOB_NOT_FOUND_ERROR))
        .mockResolvedValueOnce({ address: address(JOB_2) } as Job);

      await onMarketUpdate(mockDb, marketAccount);

      expect(mockJobsUpdateMany).toHaveBeenCalledWith(
        { job: { $in: [JOB_1] } },
        { $set: { state: JobState.STOPPED } }
      );
    });

    it('should check all jobs when market is NODE_QUEUE type', async () => {
      const queuedJobs = [
        createQueuedJob(JOB_1, DEPLOYMENT_1, TX_1),
        createQueuedJob(JOB_2, DEPLOYMENT_1, TX_2)
      ];
      const marketAccount = setupMarketUpdate(queuedJobs, [], MarketQueueType.NODE_QUEUE);
      mockJobsGet
        .mockRejectedValueOnce(new Error(JOB_NOT_FOUND_ERROR))
        .mockResolvedValueOnce({ address: address(JOB_2) } as Job);

      await onMarketUpdate(mockDb, marketAccount);

      expect(mockJobsUpdateMany).toHaveBeenCalledWith(
        { job: { $in: [JOB_1] } },
        { $set: { state: JobState.STOPPED } }
      );
    });

    it('should not check jobs that are still in the queue', async () => {
      const queuedJobs = [
        createQueuedJob(JOB_1, DEPLOYMENT_1, TX_1),
        createQueuedJob(JOB_2, DEPLOYMENT_1, TX_2)
      ];
      const marketAccount = setupMarketUpdate(queuedJobs, [JOB_1, JOB_2]);

      await onMarketUpdate(mockDb, marketAccount);

      expect(mockJobsGet).not.toHaveBeenCalled();
      expect(mockJobsUpdateMany).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully without updating jobs', async () => {
      const queuedJobs = [createQueuedJob(JOB_1, DEPLOYMENT_1, TX_1)];
      const marketAccount = setupMarketUpdate(queuedJobs, []);
      mockJobsGet.mockRejectedValue(new Error('Network error'));

      await expect(onMarketUpdate(mockDb, marketAccount)).resolves.not.toThrow();

      expect(mockJobsUpdateMany).not.toHaveBeenCalled();
    });
  });
});