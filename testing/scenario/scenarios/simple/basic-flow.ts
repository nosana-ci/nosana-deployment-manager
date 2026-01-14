import { describe, it } from 'vitest';
import { Deployment } from '@nosana/api';
import { DeploymentStatus, DeploymentStrategy } from '@nosana/kit';

import { createState } from '../../utils/index.js';
import { checkAllJobsStopped, checkDeploymentsJobs, checkSufficientVaultBalance, createDeployment, startDeployment, stopDeployment, waitForDeploymentStatus } from '../../common/index.js';

export function basicFlowScenario() {
  describe('Simple Deployment Strategy - Basic Flow', () => {
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

    it('start deployment', startDeployment(deployment));

    it('wait for deployment to be running', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.RUNNING }));

    it('wait for first job to be posted', checkDeploymentsJobs(
      deployment,
      { expectedJobsCount: 1 }
    ));

    it('stop deployment', stopDeployment(deployment));

    it('wait for deployment to be stopped', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.STOPPED }));

    it('check if all jobs are stopped', checkAllJobsStopped(deployment));
  });
}
