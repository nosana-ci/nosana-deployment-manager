import { Deployment } from '@nosana/api';
import { DeploymentStatus, DeploymentStrategy } from '@nosana/kit';

import { createState, createFlow } from '../../utils/index.js';
import { checkAllJobsStopped, checkDeploymentsJobs, checkSufficientVaultBalance, createDeployment, startDeployment, stopDeployment, waitForDeploymentStatus } from '../../common/index.js';
import { testRunId } from "../../setup.js";

createFlow('Multiple Replicas', (step) => {
  const deployment = createState<Deployment>();

  step('creates deployment with SCHEDULED strategy and multiple replicas', async () => {
    await createDeployment(
      deployment,
      {
        name: `${testRunId} :: Scenario testing: scheduled > multiple replicas`,
        strategy: DeploymentStrategy.SCHEDULED,
        schedule: '*/1 * * * *', // every minute
        replicas: 2,
      },
    )();
  });

  step('check vault has sufficient funds', checkSufficientVaultBalance(deployment));

  step('start deployment', startDeployment(deployment));

  step('wait for deployment to be running', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.RUNNING }));

  step('wait for jobs to be posted (one per replica)', checkDeploymentsJobs(
    deployment,
    { expectedJobsCount: 2 }
  ));

  step('stop deployment', stopDeployment(deployment));

  step('wait for deployment to be stopped', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.STOPPED }));

  step('check if all jobs are stopped', checkAllJobsStopped(deployment));
});

