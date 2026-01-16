import { expect } from 'vitest';
import { Deployment } from '@nosana/api';
import { address, DeploymentStatus, DeploymentStrategy, JobState } from '@nosana/kit';

import { createState, createFlow } from '../../utils/index.js';
import { createDeployment, checkDeploymentsJobs, checkSufficientVaultBalance, waitForDeploymentStatus, startDeployment, waitForJobState, checkDeploymentExtendTask, waitForTaskComplete, checkJobsTimeout, finishJob, joinMarketQueue, verifyJobAssignedToNode, checkAllJobsStopped } from '../../common/index.js';
import { deployerClient, testRunId } from '../../setup.js';

createFlow('Basic Flow', (step) => {
  const deployment = createState<Deployment>();
  const firstJob = createState<string>();

  step('creates deployment with SIMPLE-EXTEND strategy', createDeployment(
    deployment,
    {
      name: `${testRunId} :: Scenario testing: simple-extend > basic flow`,
      strategy: DeploymentStrategy["SIMPLE-EXTEND"],
      timeout: 1.5
    },
  ));

  step('check vault has sufficient funds', checkSufficientVaultBalance(deployment));

  step('join market queue before starting deployment', joinMarketQueue(() => deployment.get().market));

  step('start deployment', startDeployment(deployment));

  step('wait for deployment to be running', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.RUNNING }));

  step('wait for first job to be posted', checkDeploymentsJobs(
    deployment,
    { expectedJobsCount: 1 },
    ({ jobs }) => firstJob.set(jobs[0].job)
  ));

  step('wait for first job to be running', waitForJobState(firstJob, { expectedState: JobState.RUNNING }));

  step('verify job is assigned to our node', verifyJobAssignedToNode(() => firstJob.get(), { expectedState: 1 }));

  step('wait for extend task to be scheduled', checkDeploymentExtendTask(deployment, { job: firstJob },
    async (task) => {
      const jobDetails = await deployerClient.jobs.get(address(firstJob.get()));
      const expectedDueAtMs = (Number(jobDetails!.timeStart) + Number(jobDetails!.timeout) - 60) * 1000;
      const actualDueAtMs = new Date(task!.due_at).getTime();
      expect(Math.abs(actualDueAtMs - expectedDueAtMs)).toBeLessThan(5000);
    }
  ));

  step('wait for extend task to execute (<= 2 minutes)', waitForTaskComplete(deployment));

  step('validate job has been extended', checkJobsTimeout(deployment, () => firstJob.get()));

  step('wait for extend task to be scheduled', checkDeploymentExtendTask(deployment, { job: firstJob }));

  step('verify first job is assigned to our node', verifyJobAssignedToNode(() => firstJob.get(), { expectedState: 1 }));

  step('finish first job prematurely', finishJob(() => firstJob.get()));

  step('wait for deployment to be stopped', waitForDeploymentStatus(
    deployment, { expectedStatus: DeploymentStatus.STOPPED },
    async () => {
      const tasks = await deployment.get().getTasks();
      expect(tasks.length).toBe(0);
    }
  ));

  step('check if all jobs are stopped', checkAllJobsStopped(deployment));
});

