import { Deployment } from '@nosana/api';
import { DeploymentStatus, DeploymentStrategy } from '@nosana/kit';

import { createState, createFlow } from '../../utils/index.js';
import { checkAllJobsStopped, checkDeploymentsJobs, checkSufficientVaultBalance, createDeployment, startDeployment, stopDeployment, waitForDeploymentStatus } from '../../common/index.js';
import { testRunId } from "../../setup.js";

createFlow('Basic Flow', (step) => {
  const deployment = createState<Deployment>();

  step('creates deployment with SIMPLE strategy', async () => {
    await createDeployment(
      deployment,
      {
        name: `${testRunId} :: Scenario testing: simple > basic flow`,
        strategy: DeploymentStrategy.SIMPLE,
      },
    )();
  });

  step('check vault has sufficient funds', checkSufficientVaultBalance(deployment));

  step('start deployment', startDeployment(deployment));

  step('wait for deployment to be running', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.RUNNING }));

  step('wait for first job to be posted', checkDeploymentsJobs(
    deployment,
    { expectedJobsCount: 1 }
  ));

  step('stop deployment', stopDeployment(deployment));

  step('wait for deployment to be stopped', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.STOPPED }));

  step('check if all jobs are stopped', checkAllJobsStopped(deployment));
});
