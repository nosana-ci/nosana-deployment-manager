import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getTimeTwentyMinutesBeforeTimeout,
  infiniteJobRunningUpdate,
  STATE_FIELD,
  UPDATE_EVENT_TYPE
} from './jobRunningUpdate.js';
import { DeploymentStrategy, DeploymentStatus, JobState, TaskType } from '../../../types/index.js';
import type { Db } from 'mongodb';

vi.mock('../../../tasks/scheduleTask.js', () => ({
  scheduleTask: vi.fn()
}));

import { scheduleTask } from '../../../tasks/scheduleTask.js';

const mockNow = new Date('2025-12-02T16:00:00Z');
const testJobDeployment = 'job-deployment-123';

const testDeployment = 'deployment-123';
describe('infiniteJobRunningUpdate', () => {
  const mockFindOne = vi.fn();
  const mockCountDocuments = vi.fn();
  const mockDb = {
    collection: vi.fn().mockReturnValue({
      findOne: mockFindOne,
      countDocuments: mockCountDocuments
    })
  } as unknown as Db;

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

  const [eventType, handler, options] = infiniteJobRunningUpdate;

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
      expect(eventType).toBe(UPDATE_EVENT_TYPE);
    });

    it('should listen to state field changes', () => {
      expect(options?.fields).toEqual([STATE_FIELD]);
    });

    it('should filter for RUNNING state', () => {
      expect(options?.filters).toEqual({ state: { $eq: JobState.RUNNING } });
    });
  });

  describe('early return cases', () => {
    it('should return early when deployment is not found', async () => {
      mockFindOne.mockResolvedValue(null);

      await handler({ deployment: testJobDeployment }, mockDb);

      expect(mockFindOne).toHaveBeenCalledWith({ deployment: testJobDeployment });
      expect(mockCountDocuments).not.toHaveBeenCalled();
      expect(scheduleTask).not.toHaveBeenCalled();
    });

    it('should return early when deployment strategy is not INFINITE', async () => {
      mockFindOne.mockResolvedValue({
        ...baseDeployment,
        strategy: DeploymentStrategy.SIMPLE
      });

      await handler({ deployment: testJobDeployment }, mockDb);

      expect(scheduleTask).not.toHaveBeenCalled();
    });

    it('should return early for SIMPLE-EXTEND strategy', async () => {
      mockFindOne.mockResolvedValue({
        ...baseDeployment,
        strategy: DeploymentStrategy['SIMPLE-EXTEND']
      });

      await handler({ deployment: testJobDeployment }, mockDb);

      expect(scheduleTask).not.toHaveBeenCalled();
    });

    it('should return early for SCHEDULED strategy', async () => {
      mockFindOne.mockResolvedValue({
        ...baseDeployment,
        strategy: DeploymentStrategy.SCHEDULED,
        schedule: '0 0 * * *'
      });

      await handler({ deployment: testJobDeployment }, mockDb);

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

    describe('when running jobs exceed replicas', () => {
      it('should schedule STOP task when running jobs exceed replicas by 1', async () => {
        mockCountDocuments.mockResolvedValue(4); // 4 jobs, 3 replicas

        await handler({ deployment: testJobDeployment }, mockDb);

        expect(scheduleTask).toHaveBeenCalledWith(
          mockDb,
          TaskType.STOP,
          testDeployment,
          DeploymentStatus.RUNNING,
          mockNow,
          { limit: 1 }
        );
      });

      it('should schedule STOP task with correct excess count for multiple excess jobs', async () => {
        mockCountDocuments.mockResolvedValue(8); // 8 jobs, 3 replicas = 5 excess

        await handler({ deployment: testJobDeployment }, mockDb);

        expect(scheduleTask).toHaveBeenCalledWith(
          mockDb,
          TaskType.STOP,
          testDeployment,
          DeploymentStatus.RUNNING,
          mockNow,
          { limit: 5 }
        );
      });

      it('should count only QUEUED and RUNNING jobs', async () => {
        mockCountDocuments.mockResolvedValue(4);

        await handler({ deployment: testJobDeployment }, mockDb);

        expect(mockCountDocuments).toHaveBeenCalledWith({
          deployment: testJobDeployment,
          state: {
            $in: [JobState.QUEUED, JobState.RUNNING],
          },
        });
      });
    });

    describe('when running jobs do not exceed replicas', () => {
      it('should schedule LIST task when running jobs equal replicas', async () => {
        mockCountDocuments.mockResolvedValue(3); // 3 jobs, 3 replicas

        await handler({ deployment: testJobDeployment }, mockDb);

        expect(scheduleTask).toHaveBeenCalledWith(
          mockDb,
          TaskType.LIST,
          testDeployment,
          DeploymentStatus.RUNNING,
          expect.any(Date)
        );
      });

      /*
       * TODO: Should we in this case schedule immediately?
       */
      it('should schedule LIST task when running jobs are less than replicas', async () => {
        mockCountDocuments.mockResolvedValue(1); // 1 job, 3 replicas

        await handler({ deployment: testJobDeployment }, mockDb);

        expect(scheduleTask).toHaveBeenCalledWith(
          mockDb,
          TaskType.LIST,
          testDeployment,
          DeploymentStatus.RUNNING,
          expect.any(Date)
        );
      });

      /*
       * TODO: Should we in this case schedule immediately?
       */
      it('should schedule LIST task when there are no running jobs', async () => {
        mockCountDocuments.mockResolvedValue(0);

        await handler({ deployment: testJobDeployment }, mockDb);

        expect(scheduleTask).toHaveBeenCalledWith(
          mockDb,
          TaskType.LIST,
          testDeployment,
          DeploymentStatus.RUNNING,
          expect.any(Date)
        );
      });

      it('should calculate LIST task time as 20 minutes before timeout', async () => {
        const timeout = 3600; // 1 hour in seconds
        mockFindOne.mockResolvedValue({
          ...baseDeployment,
          strategy: DeploymentStrategy.INFINITE,
          timeout
        });
        mockCountDocuments.mockResolvedValue(3);

        await handler({ deployment: testJobDeployment }, mockDb);

        const expectedTime = getTimeTwentyMinutesBeforeTimeout(timeout);
        expect(scheduleTask).toHaveBeenCalledWith(
          mockDb,
          TaskType.LIST,
          testDeployment,
          DeploymentStatus.RUNNING,
          expectedTime
        );
      });

      it('should calculate correct time for different timeout values', async () => {
        const timeout = 7200; // 2 hours in seconds
        mockFindOne.mockResolvedValue({
          ...baseDeployment,
          strategy: DeploymentStrategy.INFINITE,
          timeout
        });
        mockCountDocuments.mockResolvedValue(2);

        await handler({ deployment: testJobDeployment }, mockDb);

        const expectedTime = getTimeTwentyMinutesBeforeTimeout(timeout);
        expect(scheduleTask).toHaveBeenCalledWith(
          mockDb,
          TaskType.LIST,
          testDeployment,
          DeploymentStatus.RUNNING,
          expectedTime
        );
      });
    });
  });
});
