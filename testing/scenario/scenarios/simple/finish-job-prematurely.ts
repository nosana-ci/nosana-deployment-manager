import { describe, it, expect } from 'vitest';
import { Deployment } from '@nosana/api';
import { DeploymentStatus, DeploymentStrategy } from '@nosana/kit';

import { createState } from '../../utils/index.js';
import { JobState } from '../../../../src/types/index.js';
import { checkAllJobsStopped, checkDeploymentsJobs, checkSufficientVaultBalance, createDeployment, joinMarketQueue, startDeployment, finishJob, verifyJobAssignedToNode, waitForDeploymentStatus } from '../../common/index.js';

export function finishJobPrematurelyScenario() {
  describe('Simple Deployment Strategy - Finish Job Prematurely', () => {
    const deployment = createState<Deployment>();
    const firstJob = createState<string>();

    it('creates deployment with SIMPLE strategy', async () => {
      await createDeployment(
        deployment,
        {
          strategy: DeploymentStrategy.SIMPLE,
        },
      )();
    });

    it('check vault has sufficient funds', checkSufficientVaultBalance(deployment));

    it('join market queue before starting deployment', joinMarketQueue(() => deployment.get().market));

    it('start deployment', startDeployment(deployment));

    it('wait for deployment to be running', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.RUNNING }));

    it('wait for first job to be posted', checkDeploymentsJobs(
      deployment,
      { expectedJobsCount: 1 },
      ({ jobs }) => firstJob.set(jobs[0].job)
    ));

    it('verify job is assigned to our node', verifyJobAssignedToNode(() => firstJob.get(), { expectedState: 1 }));

    it('finish job prematurely', finishJob(() => firstJob.get()));

    it('wait for deployment to be stopped', waitForDeploymentStatus(
      deployment,
      { expectedStatus: DeploymentStatus.STOPPED },
      // @ts-expect-error Job state is not yet reflected in kit types
      ({ jobs }) => expect(jobs.every(({ state }) => state === JobState.STOPPED || state === JobState.COMPLETED)).toBe(true)
    ));

    it('check if all jobs are stopped', checkAllJobsStopped(deployment));
  });
}
