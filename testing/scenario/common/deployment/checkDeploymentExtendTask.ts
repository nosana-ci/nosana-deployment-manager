import { expect } from 'vitest';
import type { Deployment } from '@nosana/api';
import { address } from '@nosana/kit';

import { deployerClient } from '../../setup.js';
import { State } from '../../utils/createState.js';
import { TaskDocument } from '../../../../src/types/index.js';


export function checkDeploymentExtendTask(
  state: State<Deployment>,
  { job }: { job: State<string> },
  callback?: (task: TaskDocument) => void
) {
  return async () => {
    let deployment = state.get();
    let task: TaskDocument | undefined = undefined;
    expect.poll(
      async () => {
        const tasks = await deployment.getTasks();
        // @ts-expect-error TaskDocument type is not yet reflected in kit types
        task = tasks.find((t) => t.task === "EXTEND" && t.job === job.get());
        return tasks;
      },
      { message: 'Waiting for extend task to be created' }
    ).toBeDefined();

    callback?.(task!);
  }
}


