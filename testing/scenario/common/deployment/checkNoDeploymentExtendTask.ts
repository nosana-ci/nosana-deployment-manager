import { expect } from 'vitest';
import type { Deployment } from '@nosana/api';

import { State } from '../../utils/createState.js';
import { TaskType } from '../../../../src/types/index.js';

// Temporary type until kit swagger is updated
type TempTasks = {
  task: TaskType,
  deploymentId: string,
  job: string | null,
  limit: number | null,
  active_revision: number | null,
  due_at: string,
  created_at: string,
  tx: string
}

export function checkNoDeploymentExtendTask(
  state: State<Deployment>,
  { job: expectedJob }: { job: State<string> }
) {
  return async () => {
    const deployment = state.get();

    const tasks = await deployment.getTasks() as TempTasks[];
    const hasExtendTask = tasks.some(({ job }) => {
      return job === expectedJob.get();
    });

    expect(hasExtendTask).toBe(false);
  };
}

