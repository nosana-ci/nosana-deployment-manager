import { describe, it, expect } from 'vitest';
import { Deployment } from "@nosana/api";
import { address, DeploymentStatus, DeploymentStrategy, JobState } from "@nosana/kit";

import { createState } from '../utils/index.js';
import { createDeployment, checkDeploymentsJobs, checkSufficientVaultBalance, waitForDeploymentStatus, startDeployment, waitForJobState, checkDeploymentExtendTask, waitForTaskComplete, checkJobsTimeout, stopJob } from '../common/index.js';
import { deployerClient } from '../setup.js';

describe('Simple Extend Deployment Strategy', () => {
  const deployment = createState<Deployment>();
  const firstJob = createState<string>();

  it('creates deployment with SIMPLE-EXTEND strategy', createDeployment(
    deployment,
    { strategy: DeploymentStrategy["SIMPLE-EXTEND"] },
  ));

  it('check vault has sufficient funds', checkSufficientVaultBalance(deployment));

  it('start deployment', startDeployment(deployment));

  it('wait for deployment to be running', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.RUNNING }));

  it('wait for first job to be posted', checkDeploymentsJobs(
    deployment,
    { expectedJobsCount: 1 },
    ({ jobs }) => firstJob.set(jobs[0].job)
  ));

  it('wait for first job to be running', waitForJobState(firstJob, { expectedState: JobState.RUNNING }));

  it('wait for extend task to be scheduled', checkDeploymentExtendTask(deployment, { job: firstJob },
    async (task) => {
      const jobDetails = await deployerClient.jobs.get(address(firstJob.get()));
      const expectedDueAt = new Date(Number(jobDetails!.timeStart) + Number(jobDetails!.timeout) - 60 * 1000);
      expect(task!.due_at).toBe(expectedDueAt.toISOString());
    }
  ));

  it('wait for extend task to execute', waitForTaskComplete(deployment));

  it('validate job has been extended', checkJobsTimeout(deployment, () => firstJob.get()));

  it('wait for extend task to be scheduled', checkDeploymentExtendTask(deployment, { job: firstJob }));

  it('stop new job prematurely', stopJob(() => deployment.get().jobs.find(({ job }) => job !== firstJob.get())!.job));

  it('wait for deployment to be stopped', waitForDeploymentStatus(
    deployment, { expectedStatus: DeploymentStatus.STOPPED },
    async ({ jobs }) => {
      // @ts-expect-error Job state is not yet reflected in kit types
      expect(jobs.every(({ state }) => state === JobState.STOPPED)).toBe(true)
      const tasks = await deployment.get().getTasks();
      expect(tasks.length).toBe(0);
    }
  ));
});