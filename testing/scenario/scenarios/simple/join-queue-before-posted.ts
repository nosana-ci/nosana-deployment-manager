import { describe, it, expect } from 'vitest';
import { Deployment } from '@nosana/api';
import { DeploymentStatus, DeploymentStrategy } from '@nosana/kit';

import { createState } from '../../utils/index.js';
import { JobState } from '../../../../src/types/index.js';
import { checkAllJobsStopped, checkDeploymentsJobs, checkSufficientVaultBalance, createDeployment, joinMarketQueue, startDeployment, stopDeployment, waitForDeploymentStatus, waitForSeconds } from '../../common/index.js';

export function joinQueueBeforePostedScenario() {
  describe('Join Queue Before Job Posted', () => {
    const deployment = createState<Deployment>();

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

    it('wait for second job to be posted', checkDeploymentsJobs(
      deployment,
      { expectedJobsCount: 1 },
      ({ jobs }) => {
        // @ts-expect-error Job state is not yet reflected in kit types
        expect(jobs.some((job) => job.state !== JobState.STOPPED)).toBeTruthy();
      }
    ));

    it('wait 10 seconds to allow job to run', waitForSeconds(10));

    it('stop deployment', stopDeployment(deployment));

    it('wait for deployment to be stopped', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.STOPPED }));

    it('check if all jobs are stopped', checkAllJobsStopped(deployment));
  });
}
