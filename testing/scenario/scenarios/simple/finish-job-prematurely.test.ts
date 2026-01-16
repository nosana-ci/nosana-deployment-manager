import { expect } from 'vitest';
import { Deployment } from '@nosana/api';
import { DeploymentStatus, DeploymentStrategy } from '@nosana/kit';

import { createState, createFlow } from '../../utils/index.js';
import { JobState } from '../../../../src/types/index.js';
import { checkAllJobsStopped, checkDeploymentsJobs, checkSufficientVaultBalance, createDeployment, joinMarketQueue, startDeployment, finishJob, verifyJobAssignedToNode, waitForDeploymentStatus } from '../../common/index.js';
import { testRunId } from "../../setup.js";

createFlow('Finish Job Prematurely', (step) => {
  const deployment = createState<Deployment>();
  const firstJob = createState<string>();

  step('creates deployment with SIMPLE strategy', async () => {
    await createDeployment(
      deployment,
      {
        name: `${testRunId} :: Scenario testing: simple > finish job prematurely`,
        strategy: DeploymentStrategy.SIMPLE,
      },
    )();
  });

  step('check vault has sufficient funds', checkSufficientVaultBalance(deployment));

  step('join market queue before starting deployment', joinMarketQueue(() => deployment.get().market));

  step('start deployment', startDeployment(deployment));

  step('wait for deployment to be running', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.RUNNING }));

  step('wait for first job to be posted', checkDeploymentsJobs(
    deployment,
    { expectedJobsCount: 1 },
    ({ jobs }) => firstJob.set(jobs[0].job)
  ));

  step('verify job is assigned to our node', verifyJobAssignedToNode(() => firstJob.get(), { expectedState: 1 }));

  step('finish job prematurely', finishJob(() => firstJob.get()));

  step('wait for deployment to be stopped', waitForDeploymentStatus(
    deployment,
    { expectedStatus: DeploymentStatus.STOPPED },
    // @ts-expect-error Job state is not yet reflected in kit types
    ({ jobs }) => expect(jobs.every(({ state }) => state === JobState.STOPPED || state === JobState.COMPLETED)).toBe(true)
  ));

  step('check if all jobs are stopped', checkAllJobsStopped(deployment));
});

