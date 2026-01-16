import { expect } from 'vitest';
import { Deployment } from '@nosana/api';
import { DeploymentStatus, DeploymentStrategy } from '@nosana/kit';

import { createState, createFlow } from '../../utils/index.js';
import { JobState } from '../../../../src/types/index.js';
import { checkAllJobsStopped, checkDeploymentsJobs, checkSufficientVaultBalance, createDeployment, joinMarketQueue, startDeployment, stopDeployment, waitForDeploymentStatus, waitForSeconds } from '../../common/index.js';
import { testRunId } from "../../setup.js";

createFlow('Join Queue Before Job Posted', (step) => {
  const deployment = createState<Deployment>();

  step('creates deployment with SIMPLE strategy', async () => {
    await createDeployment(
      deployment,
      {
        name: `${testRunId} :: Scenario testing: simple > join queue before posted`,
        strategy: DeploymentStrategy.SIMPLE,
      },
    )();
  });

  step('check vault has sufficient funds', checkSufficientVaultBalance(deployment));

  step('join market queue before starting deployment', joinMarketQueue(() => deployment.get().market));

  step('start deployment', startDeployment(deployment));

  step('wait for deployment to be running', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.RUNNING }));

  step('wait for second job to be posted', checkDeploymentsJobs(
    deployment,
    { expectedJobsCount: 1 },
    ({ jobs }) => {
      // @ts-expect-error Job state is not yet reflected in kit types
      expect(jobs.some((job) => job.state !== JobState.STOPPED)).toBeTruthy();
    }
  ));

  step('wait 10 seconds to allow job to run', waitForSeconds(10));

  step('stop deployment', stopDeployment(deployment));

  step('wait for deployment to be stopped', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.STOPPED }));

  step('check if all jobs are stopped', checkAllJobsStopped(deployment));
});

