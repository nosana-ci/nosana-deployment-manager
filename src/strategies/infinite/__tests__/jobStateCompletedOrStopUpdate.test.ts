import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../tasks/scheduleTask.js', () => ({
  scheduleTask: vi.fn()
}));

vi.mock('../../../repositories/index.js', () => ({
  DeploymentsRepository: { update: vi.fn() },
  EventsRepository: { create: vi.fn() },
  JobsRepository: { findAll: vi.fn(), count: vi.fn() },
  withTransaction: vi.fn(async (fn: (session: unknown) => Promise<unknown>) => fn({ __fakeSession: true })),
}));

import { infiniteJobStateCompletedOrStopUpdate } from '../jobStateCompletedOrStopUpdate.js';
import { DeploymentStrategy, DeploymentStatus, JobState, TaskType, JobsDocumentFields, JobsDocument, EventType } from '../../../types/index.js';
import type { Db } from 'mongodb';

import { scheduleTask } from '../../../tasks/scheduleTask.js';
import { DeploymentsRepository, EventsRepository, JobsRepository, withTransaction } from '../../../repositories/index.js';

import { OnEvent } from '../../../client/listener/types.js';

const mockNow = new Date('2025-12-02T16:00:00Z');
const testJobDeployment = 'job-deployment-123';
const testDeployment = 'deployment-123';

const FIVE_MINUTES = 5 * 60 * 1000;

describe('infiniteJobStateCompletedOrStopUpdate', () => {
  const mockFindOne = vi.fn();

  const mockDb = {
    collection: vi.fn().mockImplementation((name: string) => {
      if (name === 'deployments') {
        return { findOne: mockFindOne };
      }
      return {};
    }),
  } as unknown as Db;

  const mockedDeploymentsUpdate = vi.mocked(DeploymentsRepository.update);
  const mockedEventsCreate = vi.mocked(EventsRepository.create);
  const mockedJobsFindAll = vi.mocked(JobsRepository.findAll);
  const mockedJobsCount = vi.mocked(JobsRepository.count);
  const mockedWithTransaction = vi.mocked(withTransaction);

  const mockJobDocument: JobsDocument = {
    job: 'job-123',
    deployment: testJobDeployment,
    tx: 'tx-123',
    state: JobState.RUNNING,
    created_at: new Date(),
    updated_at: new Date(),
    revision: 0
  }

  const baseDeployment = {
    id: testDeployment,
    vault: 'vault-123',
    market: 'market-123',
    owner: 'owner-123',
    name: 'test-deployment',
    status: DeploymentStatus.RUNNING,
    replicas: 3,
    timeout: 3600,
    endpoints: [],
    active_revision: 1,
    confidential: false,
    created_at: mockNow,
    updated_at: mockNow,
  };

  const [eventType, handler, options] = infiniteJobStateCompletedOrStopUpdate;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(mockNow);
    vi.clearAllMocks();

    // Re-wire withTransaction after clearAllMocks
    mockedWithTransaction.mockImplementation(
      async (fn: (session: unknown) => Promise<unknown>) => fn({ __fakeSession: true }) as Promise<never>,
    );

    // Default: no recent rapid jobs (fail-safe won't trigger)
    mockedJobsFindAll.mockResolvedValue([]);
    // Update succeeds by default — return a sentinel doc so the `if (!updated)` guard passes
    mockedDeploymentsUpdate.mockResolvedValue({ id: testDeployment } as never);
    mockedEventsCreate.mockResolvedValue({} as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('listener configuration', () => {
    it('should be an update event', () => {
      expect(eventType).toBe(OnEvent.UPDATE);
    });

    it('should listen to state field changes', () => {
      expect(options?.fields).toEqual([JobsDocumentFields.STATE]);
    });

    it('should filter for COMPLETED and STOPPED states', () => {
      expect(options?.filters).toEqual({ state: { $in: [JobState.COMPLETED, JobState.STOPPED] } });
    });
  });

  describe('early return cases', () => {
    it('should return early when deployment is not found', async () => {
      mockFindOne.mockResolvedValue(null);

      await handler(mockJobDocument, mockDb);

      expect(mockFindOne).toHaveBeenCalledWith({ id: testJobDeployment });
      expect(mockedJobsCount).not.toHaveBeenCalled();
      expect(scheduleTask).not.toHaveBeenCalled();
    });

    it('should return early when deployment strategy is not INFINITE', async () => {
      mockFindOne.mockResolvedValue({
        ...baseDeployment,
        strategy: DeploymentStrategy.SIMPLE
      });

      await handler(mockJobDocument, mockDb);

      expect(scheduleTask).not.toHaveBeenCalled();
    });

    it('should return early for SIMPLE-EXTEND strategy', async () => {
      mockFindOne.mockResolvedValue({
        ...baseDeployment,
        strategy: DeploymentStrategy['SIMPLE-EXTEND']
      });

      await handler(mockJobDocument, mockDb);

      expect(scheduleTask).not.toHaveBeenCalled();
    });

    it('should return early for SCHEDULED strategy', async () => {
      mockFindOne.mockResolvedValue({
        ...baseDeployment,
        strategy: DeploymentStrategy.SCHEDULED,
        schedule: '0 0 * * *'
      });

      await handler(mockJobDocument, mockDb);

      expect(scheduleTask).not.toHaveBeenCalled();
    });
  });

  describe('when strategy is INFINITE', () => {
    beforeEach(() => {
      mockFindOne.mockResolvedValue({
        ...baseDeployment,
        strategy: DeploymentStrategy.INFINITE
      });
    });

    describe('when running jobs are less than replicas', () => {
      it('should schedule LIST task when running jobs are less than replicas by 1', async () => {
        mockedJobsCount.mockResolvedValue(2); // 2 jobs, 3 replicas = 1 missing

        await handler(mockJobDocument, mockDb);

        expect(scheduleTask).toHaveBeenCalledWith(
          mockDb,
          TaskType.LIST,
          testDeployment,
          DeploymentStatus.RUNNING,
          mockNow,
          { limit: 1 }
        );
      });

      it('should schedule LIST task with correct limit for multiple missing jobs', async () => {
        mockedJobsCount.mockResolvedValue(0); // 0 jobs, 3 replicas = 3 missing

        await handler(mockJobDocument, mockDb);

        expect(scheduleTask).toHaveBeenCalledWith(
          mockDb,
          TaskType.LIST,
          testDeployment,
          DeploymentStatus.RUNNING,
          mockNow,
          { limit: 1 }
        );
      });

      it('should schedule LIST task immediately', async () => {
        mockedJobsCount.mockResolvedValue(1);

        await handler(mockJobDocument, mockDb);

        expect(scheduleTask).toHaveBeenCalledWith(
          mockDb,
          TaskType.LIST,
          testDeployment,
          DeploymentStatus.RUNNING,
          mockNow,
          { limit: 1 }
        );
      });

      it('should count only QUEUED and RUNNING jobs', async () => {
        mockedJobsCount.mockResolvedValue(2);

        await handler(mockJobDocument, mockDb);

        expect(mockedJobsCount).toHaveBeenCalledWith({
          deployment: testJobDeployment,
          state: {
            $in: [JobState.QUEUED, JobState.RUNNING],
          },
        });
      });
    });

    describe('when running jobs equal or exceed replicas', () => {
      it('should NOT schedule task when running jobs equal replicas', async () => {
        mockedJobsCount.mockResolvedValue(3); // 3 jobs, 3 replicas

        await handler(mockJobDocument, mockDb);

        expect(scheduleTask).not.toHaveBeenCalled();
      });

      it('should NOT schedule task when running jobs exceed replicas', async () => {
        mockedJobsCount.mockResolvedValue(5); // 5 jobs, 3 replicas

        await handler(mockJobDocument, mockDb);

        expect(scheduleTask).not.toHaveBeenCalled();
      });
    });
  });

  describe('rapid-completion fail-safe', () => {
    function makeRapidJob(minutesAgo: number, durationMs: number): JobsDocument {
      const updatedAt = new Date(mockNow.getTime() - minutesAgo * 60_000);
      return {
        ...mockJobDocument,
        state: JobState.COMPLETED,
        time_start: (updatedAt.getTime() - durationMs) / 1000,
        created_at: new Date(updatedAt.getTime() - durationMs),
        updated_at: updatedAt,
      };
    }

    beforeEach(() => {
      mockFindOne.mockResolvedValue({
        ...baseDeployment,
        strategy: DeploymentStrategy.INFINITE,
      });
    });

    it('should stop deployment when last 3 jobs all completed in under 5 minutes', async () => {
      mockedJobsFindAll.mockResolvedValue([
        makeRapidJob(0, FIVE_MINUTES - 1000),
        makeRapidJob(1, FIVE_MINUTES - 1000),
        makeRapidJob(2, FIVE_MINUTES - 1000),
      ]);

      await handler(mockJobDocument, mockDb);

      expect(mockedWithTransaction).toHaveBeenCalled();
      expect(mockedDeploymentsUpdate).toHaveBeenCalledWith(
        { id: testDeployment, status: DeploymentStatus.RUNNING },
        { status: DeploymentStatus.STOPPING },
        expect.objectContaining({ session: expect.anything() }),
      );
    });

    it('should emit a RAPID_COMPLETION_FAIL_SAFE event', async () => {
      mockedJobsFindAll.mockResolvedValue([
        makeRapidJob(0, 60_000),
        makeRapidJob(1, 60_000),
        makeRapidJob(2, 60_000),
      ]);

      await handler(mockJobDocument, mockDb);

      expect(mockedEventsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          category: EventType.DEPLOYMENT,
          deploymentId: testDeployment,
          type: 'RAPID_COMPLETION_FAIL_SAFE',
        }),
        expect.objectContaining({ session: expect.anything() }),
      );
    });

    it('should NOT emit event when deployment update returns null (race lost)', async () => {
      mockedJobsFindAll.mockResolvedValue([
        makeRapidJob(0, 60_000),
        makeRapidJob(1, 60_000),
        makeRapidJob(2, 60_000),
      ]);
      mockedDeploymentsUpdate.mockResolvedValue(null);

      await handler(mockJobDocument, mockDb);

      expect(mockedDeploymentsUpdate).toHaveBeenCalled();
      expect(mockedEventsCreate).not.toHaveBeenCalled();
    });

    it('should NOT schedule a replacement job when fail-safe triggers', async () => {
      mockedJobsFindAll.mockResolvedValue([
        makeRapidJob(0, 60_000),
        makeRapidJob(1, 60_000),
        makeRapidJob(2, 60_000),
      ]);

      await handler(mockJobDocument, mockDb);

      expect(scheduleTask).not.toHaveBeenCalled();
    });

    it('should NOT trigger when one job ran longer than 5 minutes', async () => {
      mockedJobsFindAll.mockResolvedValue([
        makeRapidJob(0, FIVE_MINUTES + 1000),
        makeRapidJob(1, 60_000),
        makeRapidJob(2, 60_000),
      ]);
      mockedJobsCount.mockResolvedValue(0);

      await handler(mockJobDocument, mockDb);

      expect(mockedDeploymentsUpdate).not.toHaveBeenCalled();
      // Should fall through to schedule a replacement job
      expect(scheduleTask).toHaveBeenCalled();
    });

    it('should NOT trigger when fewer than 3 completed jobs exist', async () => {
      mockedJobsFindAll.mockResolvedValue([
        makeRapidJob(0, 60_000),
        makeRapidJob(1, 60_000),
      ]);
      mockedJobsCount.mockResolvedValue(0);

      await handler(mockJobDocument, mockDb);

      expect(mockedDeploymentsUpdate).not.toHaveBeenCalled();
    });

    it('should query jobs created after deployment.updated_at', async () => {
      mockedJobsFindAll.mockResolvedValue([]);

      await handler(mockJobDocument, mockDb);

      expect(mockedJobsFindAll).toHaveBeenCalledWith(
        {
          deployment: testJobDeployment,
          state: { $in: [JobState.COMPLETED, JobState.STOPPED] },
          created_at: { $gte: baseDeployment.updated_at },
        },
        {
          sort: { updated_at: -1 },
          limit: baseDeployment.replicas * 3,
        },
      );
    });
  });
});
