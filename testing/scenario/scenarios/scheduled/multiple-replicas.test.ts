import { Deployment } from '@nosana/api';
import { DeploymentStatus, DeploymentStrategy } from '@nosana/kit';

import { createState, createFlow } from '../../utils/index.js';
import { testRunId } from '../../setup.js';
import {
  checkAllJobsStopped,
  checkDeploymentJobs,
  checkSufficientVaultBalance,
  createDeployment,
  joinMarketQueue,
  startDeployment,
  stopDeployment,
  waitForDeploymentEvent,
  waitForDeploymentStatus
} from '../../common/index.js';

// Two replicas, one queued node: one job is assigned and the second replica is
// reported as a shortfall until another node queues up.
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

  step('one node joins the market queue', joinMarketQueue(() => deployment.get().market));

  step('start deployment', startDeployment(deployment));

  step('wait for deployment to be running', waitForDeploymentStatus(deployment, {expectedStatus: DeploymentStatus.RUNNING}));

  step('one job is posted to the only node', checkDeploymentJobs(
    deployment,
    {expectedJobsCount: 1}
  ));

  step('the second replica is reported as a shortfall', waitForDeploymentEvent(deployment, { type: 'JOB_RESERVE_SHORTFALL' }));

  step('stop deployment', stopDeployment(deployment));

  step('wait for deployment to be stopped', waitForDeploymentStatus(deployment, {expectedStatus: DeploymentStatus.STOPPED}));

  step('check if all jobs are stopped', checkAllJobsStopped(deployment));
});
