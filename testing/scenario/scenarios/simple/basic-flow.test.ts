import { expect } from 'vitest';
import { Deployment } from '@nosana/api';
import { address, DeploymentStatus, DeploymentStrategy } from '@nosana/kit';

import { createState, createFlow } from '../../utils/index.js';
import { 
  checkAllJobsStopped, 
  checkDeploymentJobs, 
  checkSufficientVaultBalance, 
  createDeployment, 
  deleteDeployment, 
  startDeployment, 
  stopDeployment, 
  waitForDeploymentStatus 
} from '../../common/index.js';
import { deployerClient } from '../../setup.js';

createFlow('Basic Flow', (step) => {
  const deployment = createState<Deployment>();
  const firstJob = createState<string>();

  step('creates deployment with SIMPLE strategy', createDeployment(
    deployment,
    {
      name: "Scenario testing: simple > basic flow",
      strategy: DeploymentStrategy.SIMPLE,
    },
  ));

  step('check vault has sufficient funds', checkSufficientVaultBalance(deployment));

  step('start deployment', startDeployment(deployment));

  step('wait for deployment to be running', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.RUNNING }));

  step('wait for first job to be posted', checkDeploymentJobs(
    deployment,
    { expectedJobsCount: 1 },
    ({ jobs }) => firstJob.set(jobs[0].job)
  ));

  step('check on-chain job timeout matches deployment timeout', async () => {
    const onchain = await deployerClient.jobs.get(address(firstJob.get()));
    const timeoutInSeconds = deployment.get().timeout * 60;
    expect(onchain?.timeout).toBe(timeoutInSeconds);
  });

  step('stop deployment', stopDeployment(deployment));

  step('wait for deployment to be stopped', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.STOPPED }));

  step('check if all jobs are stopped', checkAllJobsStopped(deployment));

  step('delete deployment', deleteDeployment(deployment));
});
