import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Db } from 'mongodb';

import { deploymentReplicaUpdate } from '../deploymentReplicaUpdate.js';
import {
  DeploymentStrategy,
  DeploymentStatus,
  DeploymentDocumentFields,
  JobState,
  TaskType,
  type DeploymentDocument,
} from '../../../types/index.js';

import { scheduleTask } from '../../../tasks/scheduleTask.js';

vi.mock('../../../tasks/scheduleTask.js', () => ({
  scheduleTask: vi.fn(),
}));

import { OnEvent } from '../../../client/listener/types.js';

const testDeployment = 'deployment-123';

const baseDeployment: DeploymentDocument = {
  id: testDeployment,
  vault: 'vault-123',
  market: 'market-123',
  owner: 'owner-123',
  name: 'test-deployment',
  status: DeploymentStatus.RUNNING,
  replicas: 9,
  timeout: 3600,
  endpoints: [],
  active_revision: 1,
  confidential: false,
  created_at: new Date('2025-12-02T16:00:00Z'),
  updated_at: new Date('2025-12-02T16:00:00Z'),
} as unknown as DeploymentDocument;

const [eventType, handler, options] = deploymentReplicaUpdate;

describe('deploymentReplicaUpdate', () => {
  const mockCountDocuments = vi.fn();
  const mockDb = {
    collection: vi.fn().mockReturnValue({ countDocuments: mockCountDocuments }),
  } as unknown as Db;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listener configuration', () => {
    it('should be an update event', () => {
      expect(eventType).toBe(OnEvent.UPDATE);
    });

    it('should listen to replica field changes', () => {
      expect(options?.fields).toEqual([DeploymentDocumentFields.REPLICAS]);
    });

    it('only reconciles RUNNING SIMPLE / SIMPLE-EXTEND / INFINITE deployments via filters', () => {
      expect(options?.filters).toEqual({
        strategy: {
          $in: [
            DeploymentStrategy.SIMPLE,
            DeploymentStrategy['SIMPLE-EXTEND'],
            DeploymentStrategy.INFINITE,
          ],
        },
        status: { $eq: DeploymentStatus.RUNNING },
      });
    });
  });

  describe('no-op cases', () => {
    it('does nothing when the active job count already equals replicas', async () => {
      mockCountDocuments.mockResolvedValue(9); // 9 active, 9 replicas

      await handler({ ...baseDeployment, strategy: DeploymentStrategy.SIMPLE, replicas: 9 }, mockDb);

      expect(scheduleTask).not.toHaveBeenCalled();
    });
  });

  describe('upscaling (active jobs below new replica count)', () => {
    it.each([
      DeploymentStrategy.SIMPLE,
      DeploymentStrategy['SIMPLE-EXTEND'],
      DeploymentStrategy.INFINITE,
    ])('schedules a LIST task for only the shortfall on %s', async (strategy) => {
      mockCountDocuments.mockResolvedValue(2); // 2 active, 5 replicas => add 3

      await handler({ ...baseDeployment, strategy, replicas: 5 }, mockDb);

      expect(scheduleTask).toHaveBeenCalledWith(
        mockDb,
        TaskType.LIST,
        testDeployment,
        DeploymentStatus.RUNNING,
        undefined,
        { limit: 3 },
      );
    });

    it('counts only QUEUED and RUNNING jobs for the deployment', async () => {
      mockCountDocuments.mockResolvedValue(2);

      await handler({ ...baseDeployment, strategy: DeploymentStrategy.SIMPLE, replicas: 5 }, mockDb);

      expect(mockCountDocuments).toHaveBeenCalledWith({
        deployment: testDeployment,
        state: { $in: [JobState.QUEUED, JobState.RUNNING] },
      });
    });
  });

  describe('downscaling (active jobs above new replica count)', () => {
    it.each([
      DeploymentStrategy.SIMPLE,
      DeploymentStrategy['SIMPLE-EXTEND'],
      DeploymentStrategy.INFINITE,
    ])('schedules a STOP task for the excess on %s', async (strategy) => {
      mockCountDocuments.mockResolvedValue(5); // 5 active, 2 replicas => stop 3

      await handler({ ...baseDeployment, strategy, replicas: 2 }, mockDb);

      expect(scheduleTask).toHaveBeenCalledWith(
        mockDb,
        TaskType.STOP,
        testDeployment,
        DeploymentStatus.RUNNING,
        expect.any(Date),
        { limit: 3 },
      );
    });

    it('does NOT schedule a LIST task when downscaling', async () => {
      mockCountDocuments.mockResolvedValue(5);

      await handler({ ...baseDeployment, strategy: DeploymentStrategy.SIMPLE, replicas: 2 }, mockDb);

      expect(scheduleTask).not.toHaveBeenCalledWith(
        mockDb,
        TaskType.LIST,
        testDeployment,
        DeploymentStatus.RUNNING,
      );
    });

    it('supports downscaling to zero replicas', async () => {
      mockCountDocuments.mockResolvedValue(4); // 4 active, 0 replicas => stop 4

      await handler(
        { ...baseDeployment, strategy: DeploymentStrategy.INFINITE, replicas: 0 },
        mockDb,
      );

      expect(scheduleTask).toHaveBeenCalledWith(
        mockDb,
        TaskType.STOP,
        testDeployment,
        DeploymentStatus.RUNNING,
        expect.any(Date),
        { limit: 4 },
      );
    });
  });
});
