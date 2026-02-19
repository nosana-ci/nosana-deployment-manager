import { expect } from 'vitest';
import type { Deployment, DeploymentTasks } from '@nosana/api';

import { State } from '../../utils/createState.js';
import { TaskType } from '../../../../src/types/index.js';

type Task = DeploymentTasks['tasks'][number];

export function checkDeploymentExtendTask(
  state: State<Deployment>,
  { job }: { job: State<string> },
  callback?: (task: Task) => void
) {
  return async () => {
    const deployment = state.get();
    let task: Task | undefined = undefined;
    let lastTasks: Task[] = [];
    const expectedJob = job.get();

    try {
      await expect.poll(
        async () => {
          const response = await deployment.getTasks();
          lastTasks = response.tasks;
          task = response.tasks.find((t) => {
            const taskJob = t.job;
            return taskJob === expectedJob;
          });
          return task;
        },
        { message: 'Waiting for extend task to be created' }
      ).toBeDefined();
    } catch {
      const extendTasks = lastTasks
        .filter((t) => t.task === TaskType.EXTEND)
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
