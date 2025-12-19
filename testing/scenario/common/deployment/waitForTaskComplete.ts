
import { expect } from 'vitest';
import type { Deployment } from '@nosana/api';

import { State } from '../../utils/index.js';

export function waitForTaskComplete(
  deployment: State<Deployment>,
) {
  return async () => {
    const tasks = await deployment.get().getTasks();
    expect(tasks).toHaveLength(1);
    expect.poll(
      async () => {
        const newTasks = await deployment.get().getTasks();
        return newTasks.length === 0 || newTasks[0].due_at !== tasks[0].due_at;
      },
      {
        message: 'Waiting for extend task to complete',
        timeout: 5 * 60_000
      }
    ).toBeTruthy();
  }
}


