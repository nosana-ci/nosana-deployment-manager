import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { jobRapidCompletionFailSafe } from '../jobRapidCompletionFailSafe.js';
import { DeploymentStatus, JobState, JobsDocumentFields, EventType } from '../../../types/index.js';
import type { JobsDocument } from '../../../types/index.js';
import type { Db } from 'mongodb';
import { OnEvent } from '../../../client/listener/types.js';

const mockNow = new Date('2025-12-02T16:00:00Z');
const testJobDeployment = 'deployment-123';

const FIVE_MINUTES = 5 * 60 * 1000;

describe('jobRapidCompletionFailSafe', () => {
  const mockFindOne = vi.fn();
  const mockFind = vi.fn();
  const mockUpdateOne = vi.fn();
  const mockInsertOne = vi.fn();
  const mockSort = vi.fn();
  const mockLimit = vi.fn();
  const mockToArray = vi.fn();

  const mockDb = {
    collection: vi.fn().mockImplementation((name: string) => {
      if (name === 'deployments') {
        return { findOne: mockFindOne, updateOne: mockUpdateOne };
      }
      if (name === 'jobs') {
        return { find: mockFind };
      }
      if (name === 'events') {
        return { insertOne: mockInsertOne };
      }
      return {};
    }),
  } as unknown as Db;

  const mockJobDocument: JobsDocument = {
    job: 'job-abc',
    deployment: testJobDeployment,
    market: 'market-123',
    node: null,
    tx: 'tx-123',
    state: JobState.COMPLETED,
    revision: 1,
    time_start: mockNow.getTime(),
    created_at: mockNow,
    updated_at: mockNow,
  };

  const baseDeployment = {
    id: testJobDeployment,
    vault: 'vault-123',
    market: 'market-123',
    owner: 'owner-123',
    name: 'test-deployment',
    status: DeploymentStatus.RUNNING,
    replicas: 1,
    timeout: 3600,
    endpoints: [],
    active_revision: 1,
    confidential: false,
    created_at: new Date('2025-12-02T15:00:00Z'),
    updated_at: new Date('2025-12-02T15:00:00Z'),
  };

  const [eventType, handler, options] = jobRapidCompletionFailSafe;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(mockNow);
    vi.clearAllMocks();

    mockFind.mockReturnValue({ sort: mockSort });
    mockSort.mockReturnValue({ limit: mockLimit });
    mockLimit.mockReturnValue({ toArray: mockToArray });
    mockUpdateOne.mockResolvedValue({ acknowledged: true });
    mockInsertOne.mockResolvedValue({ acknowledged: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --- helpers ---
  function makeRapidJob(minutesAgo: number, durationMs: number): JobsDocument {
    const updatedAt = new Date(mockNow.getTime() - minutesAgo * 60_000);
    return {
      ...mockJobDocument,
      time_start: updatedAt.getTime() - durationMs,
      created_at: new Date(updatedAt.getTime() - durationMs),
      updated_at: updatedAt,
    };
  }

  describe('listener configuration', () => {
    it('should be an update event', () => {
      expect(eventType).toBe(OnEvent.UPDATE);
    });

    it('should listen to state field changes', () => {
      expect(options?.fields).toEqual([JobsDocumentFields.STATE]);
    });

    it('should filter for COMPLETED and STOPPED states', () => {
      expect(options?.filters).toEqual({
        state: { $in: [JobState.COMPLETED, JobState.STOPPED] },
      });
    });
  });

  describe('early return cases', () => {
    it('should return early when deployment is not found', async () => {
      mockFindOne.mockResolvedValue(null);

      await handler(mockJobDocument, mockDb);

      expect(mockFind).not.toHaveBeenCalled();
      expect(mockUpdateOne).not.toHaveBeenCalled();
    });

    it('should return early when deployment is not RUNNING', async () => {
      mockFindOne.mockResolvedValue({ ...baseDeployment, status: DeploymentStatus.STOPPED });

      await handler(mockJobDocument, mockDb);

      expect(mockFind).not.toHaveBeenCalled();
    });

    it('should return early when deployment status is STOPPING', async () => {
      mockFindOne.mockResolvedValue({ ...baseDeployment, status: DeploymentStatus.STOPPING });

      await handler(mockJobDocument, mockDb);

      expect(mockFind).not.toHaveBeenCalled();
    });

    it('should return early when fewer than 3 completed jobs exist', async () => {
      mockFindOne.mockResolvedValue(baseDeployment);
      mockToArray.mockResolvedValue([makeRapidJob(0, 1000), makeRapidJob(1, 1000)]);

      await handler(mockJobDocument, mockDb);

      expect(mockUpdateOne).not.toHaveBeenCalled();
    });
  });

  describe('fail-safe trigger', () => {
    it('should stop deployment when last 3 jobs all completed in under 5 minutes', async () => {
      mockFindOne.mockResolvedValue(baseDeployment);
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
      mockFindOne.mockResolvedValue(baseDeployment);
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

    it('should NOT stop deployment when updateOne is not acknowledged', async () => {
      mockFindOne.mockResolvedValue(baseDeployment);
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

  describe('no false positives', () => {
    it('should NOT trigger when one job ran longer than 5 minutes', async () => {
      mockFindOne.mockResolvedValue(baseDeployment);
      mockToArray.mockResolvedValue([
        makeRapidJob(0, FIVE_MINUTES + 1000), // longer than threshold
        makeRapidJob(1, 60_000),
        makeRapidJob(2, 60_000),
      ]);

      await handler(mockJobDocument, mockDb);

      expect(mockUpdateOne).not.toHaveBeenCalled();
    });

    it('should NOT trigger when all jobs are exactly at the 5-minute boundary', async () => {
      mockFindOne.mockResolvedValue(baseDeployment);
      mockToArray.mockResolvedValue([
        makeRapidJob(0, FIVE_MINUTES),
        makeRapidJob(1, FIVE_MINUTES),
        makeRapidJob(2, FIVE_MINUTES),
      ]);

      await handler(mockJobDocument, mockDb);

      expect(mockUpdateOne).not.toHaveBeenCalled();
    });
  });

  describe('lifecycle scoping via created_at', () => {
    it('should query jobs created after deployment.updated_at', async () => {
      mockFindOne.mockResolvedValue(baseDeployment);
      mockToArray.mockResolvedValue([]);

      await handler(mockJobDocument, mockDb);

      expect(mockFind).toHaveBeenCalledWith({
        deployment: testJobDeployment,
        state: { $in: [JobState.COMPLETED, JobState.STOPPED] },
        created_at: { $gte: baseDeployment.updated_at },
      });
    });

    it('should sort by updated_at descending and limit to 3', async () => {
      mockFindOne.mockResolvedValue(baseDeployment);
      mockToArray.mockResolvedValue([]);

      await handler(mockJobDocument, mockDb);

      expect(mockSort).toHaveBeenCalledWith({ updated_at: -1 });
      expect(mockLimit).toHaveBeenCalledWith(3);
    });
  });
});
