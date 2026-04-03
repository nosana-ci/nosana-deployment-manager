import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { infiniteJobStateCompletedOrStopUpdate } from '../jobStateCompletedOrStopUpdate.js';
import { DeploymentStrategy, DeploymentStatus, JobState, TaskType, JobsDocumentFields, JobsDocument, EventType } from '../../../types/index.js';
import type { Db } from 'mongodb';

import { scheduleTask } from '../../../tasks/scheduleTask.js';

vi.mock('../../../tasks/scheduleTask.js', () => ({
  scheduleTask: vi.fn()
}));

import { OnEvent } from '../../../client/listener/types.js';

const mockNow = new Date('2025-12-02T16:00:00Z');
const testJobDeployment = 'job-deployment-123';
const testDeployment = 'deployment-123';

const FIVE_MINUTES = 5 * 60 * 1000;

describe('infiniteJobStateCompletedOrStopUpdate', () => {
  const mockFindOne = vi.fn();
  const mockCountDocuments = vi.fn();
  const mockUpdateOne = vi.fn();
  const mockInsertOne = vi.fn();
  const mockToArray = vi.fn();
  const mockLimit = vi.fn().mockReturnValue({ toArray: mockToArray });
  const mockSort = vi.fn().mockReturnValue({ limit: mockLimit });
  const mockFind = vi.fn().mockReturnValue({ sort: mockSort });

  const mockDb = {
    collection: vi.fn().mockImplementation((name: string) => {
      if (name === 'deployments') {
        return { findOne: mockFindOne, updateOne: mockUpdateOne };
      }
      if (name === 'jobs') {
        return { find: mockFind, countDocuments: mockCountDocuments };
      }
      if (name === 'events') {
        return { insertOne: mockInsertOne };
      }
      return {};
    }),
  } as unknown as Db;

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

    // Re-wire the find chain after clearAllMocks
    mockFind.mockReturnValue({ sort: mockSort });
    mockSort.mockReturnValue({ limit: mockLimit });
    mockLimit.mockReturnValue({ toArray: mockToArray });

    // Default: no recent rapid jobs (fail-safe won't trigger)
    mockToArray.mockResolvedValue([]);
    mockUpdateOne.mockResolvedValue({ acknowledged: true });
    mockInsertOne.mockResolvedValue({ acknowledged: true });
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
      expect(mockCountDocuments).not.toHaveBeenCalled();
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
        mockCountDocuments.mockResolvedValue(2); // 2 jobs, 3 replicas = 1 missing

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
        mockCountDocuments.mockResolvedValue(0); // 0 jobs, 3 replicas = 3 missing

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
        mockCountDocuments.mockResolvedValue(1);

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
        mockCountDocuments.mockResolvedValue(2);

        await handler(mockJobDocument, mockDb);

        expect(mockCountDocuments).toHaveBeenCalledWith({
          deployment: testJobDeployment,
          state: {
            $in: [JobState.QUEUED, JobState.RUNNING],
          },
        });
      });
    });

    describe('when running jobs equal or exceed replicas', () => {
      it('should NOT schedule task when running jobs equal replicas', async () => {
        mockCountDocuments.mockResolvedValue(3); // 3 jobs, 3 replicas

        await handler(mockJobDocument, mockDb);

        expect(scheduleTask).not.toHaveBeenCalled();
      });

      it('should NOT schedule task when running jobs exceed replicas', async () => {
        mockCountDocuments.mockResolvedValue(5); // 5 jobs, 3 replicas

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
        time_start: updatedAt.getTime() - durationMs,
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
      mockToArray.mockResolvedValue([
        makeRapidJob(0, FIVE_MINUTES - 1000),
        makeRapidJob(1, FIVE_MINUTES - 1000),
        makeRapidJob(2, FIVE_MINUTES - 1000),
      ]);

      await handler(mockJobDocument, mockDb);

      expect(mockUpdateOne).toHaveBeenCalledWith(
        { id: testJobDeployment, status: DeploymentStatus.RUNNING },
        { $set: { status: DeploymentStatus.STOPPING } },
      );
    });

    it('should emit a RAPID_COMPLETION_FAIL_SAFE event', async () => {
      mockToArray.mockResolvedValue([
        makeRapidJob(0, 60_000),
        makeRapidJob(1, 60_000),
        makeRapidJob(2, 60_000),
      ]);

      await handler(mockJobDocument, mockDb);

      expect(mockInsertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          category: EventType.DEPLOYMENT,
          deploymentId: testJobDeployment,
          type: 'RAPID_COMPLETION_FAIL_SAFE',
        }),
      );
    });

    it('should NOT schedule a replacement job when fail-safe triggers', async () => {
      mockToArray.mockResolvedValue([
        makeRapidJob(0, 60_000),
        makeRapidJob(1, 60_000),
        makeRapidJob(2, 60_000),
      ]);

      await handler(mockJobDocument, mockDb);

      expect(scheduleTask).not.toHaveBeenCalled();
      expect(mockCountDocuments).not.toHaveBeenCalled();
    });

    it('should NOT trigger when one job ran longer than 5 minutes', async () => {
      mockToArray.mockResolvedValue([
        makeRapidJob(0, FIVE_MINUTES + 1000),
        makeRapidJob(1, 60_000),
        makeRapidJob(2, 60_000),
      ]);
      mockCountDocuments.mockResolvedValue(0);

      await handler(mockJobDocument, mockDb);

      expect(mockUpdateOne).not.toHaveBeenCalled();
      // Should fall through to schedule a replacement job
      expect(scheduleTask).toHaveBeenCalled();
    });

    it('should NOT trigger when fewer than 3 completed jobs exist', async () => {
      mockToArray.mockResolvedValue([
        makeRapidJob(0, 60_000),
        makeRapidJob(1, 60_000),
      ]);
      mockCountDocuments.mockResolvedValue(0);

      await handler(mockJobDocument, mockDb);

      expect(mockUpdateOne).not.toHaveBeenCalled();
    });

    it('should query jobs created after deployment.updated_at', async () => {
      mockToArray.mockResolvedValue([]);

      await handler(mockJobDocument, mockDb);

      expect(mockFind).toHaveBeenCalledWith({
        deployment: testJobDeployment,
        state: { $in: [JobState.COMPLETED, JobState.STOPPED] },
        created_at: { $gte: baseDeployment.updated_at },
      });
      expect(mockSort).toHaveBeenCalledWith({ updated_at: -1 });
      expect(mockLimit).toHaveBeenCalledWith(3);
    });

    it('should NOT emit event when updateOne is not acknowledged', async () => {
      mockToArray.mockResolvedValue([
        makeRapidJob(0, 60_000),
        makeRapidJob(1, 60_000),
        makeRapidJob(2, 60_000),
      ]);
      mockUpdateOne.mockResolvedValue({ acknowledged: false });

      await handler(mockJobDocument, mockDb);

      expect(mockInsertOne).not.toHaveBeenCalled();
    });
  });
});
