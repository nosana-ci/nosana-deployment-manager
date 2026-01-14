import { expect } from 'vitest';
import type { Deployment } from '@nosana/api';
import { address } from '@nosana/kit';

import { State } from '../../utils/createState.js';
import { TaskDocument } from '../../../../src/types/index.js';
import { createDeploymentsConnection } from '../../../../src/connection/deployments.js';
import { NosanaCollections } from '../../../../src/definitions/collection.js';


export function checkDeploymentExtendTask(
  state: State<Deployment>,
  { job }: { job: State<string> },
  callback?: (task: TaskDocument) => void
) {
  return async () => {
    const deployment = state.get();
    let task: TaskDocument | undefined = undefined;
    let lastTasks: TaskDocument[] = [];
    const expectedJob = address(job.get()).toString();
    const db = await createDeploymentsConnection();
    const tasksCollection = db.collection<TaskDocument>(NosanaCollections.TASKS);
    try {
      await expect.poll(
        async () => {
          const tasks = await tasksCollection
            .find({
              deploymentId: deployment.id,
              task: "EXTEND",
            })
            .toArray();
          lastTasks = tasks;
          task = tasks.find((t) => {
            const taskJob = address(t.job as string).toString();
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
          job: t.job?.toString?.() ?? t.job,
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


