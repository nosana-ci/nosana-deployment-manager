import { expect } from 'vitest';
import { Deployment } from '@nosana/api';
import { DeploymentStatus, DeploymentStrategy, JobState } from '@nosana/kit';

import { createState, createFlow } from '../../utils/index.js';
import { checkAllJobsStopped, checkDeploymentExtendTask, checkDeploymentJobs, checkSufficientVaultBalance, createDeployment, finishJob, joinMarketQueue, startDeployment, verifyJobAssignedToNode, waitForDeploymentStatus, waitForJobState } from '../../common/index.js';

createFlow('Finish Before Extend', (step) => {
  const deployment = createState<Deployment>();
  const firstJob = createState<string>();

  step('creates deployment with SIMPLE-EXTEND strategy', createDeployment(
    deployment,
    {
      name: "Scenario testing: simple-extend > finish before extend",
      strategy: DeploymentStrategy["SIMPLE-EXTEND"]
    },
  ));

  step('check vault has sufficient funds', checkSufficientVaultBalance(deployment));

  step('join market queue before starting deployment', joinMarketQueue(() => deployment.get().market));

  step('start deployment', startDeployment(deployment));

  step('wait for deployment to be running', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.RUNNING }));

  step('wait for first job to be posted', checkDeploymentJobs(
    deployment,
    { expectedJobsCount: 1 },
    ({ jobs }) => firstJob.set(jobs[0].job)
  ));

  step('wait for first job to be running', waitForJobState(firstJob, { expectedState: JobState.RUNNING }));

  step('verify job is assigned to our node', verifyJobAssignedToNode(() => firstJob.get(), { expectedState: 1 }));

  step('wait for extend task to be scheduled', checkDeploymentExtendTask(deployment, { job: firstJob }));

  step('finish job before extend executes', finishJob(() => firstJob.get()));

  step('wait for deployment to be stopped and tasks removed', waitForDeploymentStatus(
    deployment, { expectedStatus: DeploymentStatus.STOPPED },
    async () => {
      const tasks = await deployment.get().getTasks();
      expect(tasks.tasks.length).toBe(0);
    }
  ));

  step('check if all jobs are stopped', checkAllJobsStopped(deployment));
});

