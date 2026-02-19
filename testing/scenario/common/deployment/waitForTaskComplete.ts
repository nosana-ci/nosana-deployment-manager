
import { expect } from 'vitest';
import type { Deployment } from '@nosana/api';

import { State } from '../../utils/index.js';

export function waitForTaskComplete(
  deployment: State<Deployment>,
) {
  return async () => {
    const response = await deployment.get().getTasks();
    expect(response.tasks).toHaveLength(1);
    await expect.poll(
      async () => {
        const newResponse = await deployment.get().getTasks();
        return newResponse.tasks.length === 0 || newResponse.tasks[0].due_at !== response.tasks[0].due_at;
      },
      {
        message: 'Waiting for extend task to complete',
        timeout: 5 * 60_000
      }
    ).toBeTruthy();
  }
}


