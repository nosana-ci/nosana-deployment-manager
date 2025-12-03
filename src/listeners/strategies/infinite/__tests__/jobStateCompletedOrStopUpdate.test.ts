import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { infiniteJobStateCompletedOrStopUpdate } from '../jobStateCompletedOrStopUpdate.js';
import { DeploymentStrategy, DeploymentStatus, JobState, TaskType, JobsDocumentFields, JobsDocument } from '../../../../types/index.js';
import type { Db } from 'mongodb';

import { scheduleTask } from '../../../../tasks/scheduleTask.js';

vi.mock('../../../../tasks/scheduleTask.js', () => ({
  scheduleTask: vi.fn()
}));

import { OnEvent } from '../../../../client/listener/types.js';

const mockNow = new Date('2025-12-02T16:00:00Z');
const testJobDeployment = 'job-deployment-123';
const testDeployment = 'deployment-123';

describe('infiniteJobStateCompletedOrStopUpdate', () => {
  const mockFindOne = vi.fn();
  const mockCountDocuments = vi.fn();
  const mockDb = {
    collection: vi.fn().mockReturnValue({
      findOne: mockFindOne,
      countDocuments: mockCountDocuments,
      insertOne: vi.fn().mockImplementation(() => Promise.resolve({ acknowledged: true }))
    })
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

      expect(mockFindOne).toHaveBeenCalledWith({ deployment: testJobDeployment });
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
});
