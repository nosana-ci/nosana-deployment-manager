import { expect } from 'vitest';
import type { Deployment } from '@nosana/api';
import { address } from '@nosana/kit';

import { State } from '../../utils/createState.js';
import { TaskDocument } from '../../../../src/types/index.js';
import { createDeploymentsConnection } from '../../../../src/connection/deployments.js';
import { NosanaCollections } from '../../../../src/definitions/collection.js';

export function checkNoDeploymentExtendTask(
  state: State<Deployment>,
  { job }: { job: State<string> }
) {
  return async () => {
    const deployment = state.get();
    const expectedJob = address(job.get()).toString();
    const db = await createDeploymentsConnection();
    const tasksCollection = db.collection<TaskDocument>(NosanaCollections.TASKS);
    const tasks = await tasksCollection
      .find({
        deploymentId: deployment.id,
        task: "EXTEND",
      })
      .toArray();
    const hasExtendTask = tasks.some((task) => {
      const taskJob = address(task.job as string).toString();
      return taskJob === expectedJob;
    });

    expect(hasExtendTask).toBe(false);
  };
}

