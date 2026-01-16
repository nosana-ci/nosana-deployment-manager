import { expect } from 'vitest';
import { Deployment } from '@nosana/api';
import { DeploymentStatus, DeploymentStrategy } from '@nosana/kit';

import { createState, createFlow } from '../../utils/index.js';
import { JobState } from '../../../../src/types/index.js';
import { checkAllJobsStopped, checkDeploymentJobs, checkSufficientVaultBalance, createDeployment, startDeployment, stopDeployment, waitForDeploymentStatus } from '../../common/index.js';

createFlow('Multiple Replicas', (step) => {
  const deployment = createState<Deployment>();

  step('creates deployment with SIMPLE strategy and multiple replicas', createDeployment(
    deployment,
    {
      name: "Scenario testing: simple > multiple replicas",
      strategy: DeploymentStrategy.SIMPLE,
      replicas: 3,
    },
  ));

  step('check vault has sufficient funds', checkSufficientVaultBalance(deployment));

  step('start deployment', startDeployment(deployment));

  step('wait for deployment to be running', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.RUNNING }));

  step('wait for jobs to be posted (one per replica)', checkDeploymentJobs(
    deployment,
    { expectedJobsCount: 3 },
    ({ jobs }) => {
      // @ts-expect-error Job state is not yet reflected in kit types
      expect(jobs.some((job) => job.state !== JobState.STOPPED)).toBeTruthy();
    }
  ));

  step('stop deployment', stopDeployment(deployment));

  step('wait for deployment to be stopped', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.STOPPED }));

  step('check if all jobs are stopped', checkAllJobsStopped(deployment));
});

