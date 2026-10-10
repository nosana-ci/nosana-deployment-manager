import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Db } from 'mongodb';

import { deploymentRevisionUpdate } from '../deploymentRevisionUpdate.js';
import { DeploymentStatus, DeploymentStrategy, TaskType, type DeploymentDocument } from '../../../types/index.js';

import { scheduleTask } from '../../../tasks/scheduleTask.js';

vi.mock('../../../tasks/scheduleTask.js', () => ({
  scheduleTask: vi.fn(),
}));

const db = {} as Db;

const deployment = (over: Record<string, unknown> = {}) =>
  ({
    id: 'dep-1',
    status: DeploymentStatus.RUNNING,
    strategy: DeploymentStrategy.SIMPLE,
    active_revision: 3,
    ...over,
  }) as unknown as DeploymentDocument;

const [, handler, options] = deploymentRevisionUpdate;

describe('deploymentRevisionUpdate', () => {
  beforeEach(() => {
    vi.mocked(scheduleTask).mockReset().mockResolvedValue(true);
  });

  it('reconciles to the new revision: a STOP of the other revisions and a LIST of this one, both keyed on it', async () => {
    await handler(deployment(), db);

    expect(scheduleTask).toHaveBeenNthCalledWith(1, db, TaskType.STOP, 'dep-1', DeploymentStatus.RUNNING, expect.any(Date), {
      active_revision: 3,
      reason: 'revision',
      idempotent: true,
    });
    expect(scheduleTask).toHaveBeenNthCalledWith(2, db, TaskType.LIST, 'dep-1', DeploymentStatus.RUNNING, undefined, {
      active_revision: 3,
      reason: 'revision',
      idempotent: true,
    });
  });

  it('lists a SCHEDULED deployment at its next firing', async () => {
    await handler(deployment({ strategy: DeploymentStrategy.SCHEDULED, schedule: '*/5 * * * *' }), db);

    expect(scheduleTask).toHaveBeenNthCalledWith(2, db, TaskType.LIST, 'dep-1', DeploymentStatus.RUNNING, expect.any(Date), {
      active_revision: 3,
      reason: 'revision',
      idempotent: true,
    });
  });

  it('schedules whatever the status: a stopped deployment drops the tasks when they come due', async () => {
    await handler(deployment({ status: DeploymentStatus.STOPPED }), db);

    expect(scheduleTask).toHaveBeenCalledTimes(2);
    expect(options?.filters).toEqual({ status: { $ne: DeploymentStatus.DRAFT } });
  });
});
