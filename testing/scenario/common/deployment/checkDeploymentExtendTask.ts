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

export function checkDeploymentExtendTask(
  state: State<Deployment>,
  { job }: { job: State<string> },
  callback?: (task: TempTasks) => void
) {
  return async () => {
    const deployment = state.get();
    let task: TempTasks | undefined = undefined;
    let lastTasks: TempTasks[] = [];
    const expectedJob = job.get();

    try {
      await expect.poll(
        async () => {
          const tasks = await deployment.getTasks() as TempTasks[];
          lastTasks = tasks;
          task = tasks.find((t) => {
            const taskJob = t.job;
            return taskJob === expectedJob;
          });
          return task;
        },
        { message: 'Waiting for extend task to be created' }
      ).toBeDefined();
    } catch {
      const extendTasks = lastTasks
        .filter((t) => t.task === "EXTEND")
        .map((t) => ({
          job: t.job,
          due_at: t.due_at,
        }));
      throw new Error(
        `Extend task not found for job ${expectedJob}. ` +
        `Found ${extendTasks.length} EXTEND task(s): ${JSON.stringify(extendTasks)}`
      );
    }

    callback?.(task!);
  }
}


