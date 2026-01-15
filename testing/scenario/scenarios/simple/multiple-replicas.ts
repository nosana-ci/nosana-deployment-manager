import { describe, it, expect } from 'vitest';
import { Deployment } from '@nosana/api';
import { DeploymentStatus, DeploymentStrategy } from '@nosana/kit';

import { createState } from '../../utils/index.js';
import { JobState } from '../../../../src/types/index.js';
import { checkAllJobsStopped, checkDeploymentsJobs, checkSufficientVaultBalance, createDeployment, startDeployment, stopDeployment, waitForDeploymentStatus } from '../../common/index.js';

export function multipleReplicasScenario() {
  describe('Multiple Replicas', () => {
    const deployment = createState<Deployment>();

    it('creates deployment with SIMPLE strategy and multiple replicas', async () => {
      await createDeployment(
        deployment,
        {
          strategy: DeploymentStrategy.SIMPLE,
          replicas: 3,
        },
      )();
    });

    it('check vault has sufficient funds', checkSufficientVaultBalance(deployment));

    it('start deployment', startDeployment(deployment));

    it('wait for deployment to be running', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.RUNNING }));

    it('wait for jobs to be posted (one per replica)', checkDeploymentsJobs(
      deployment,
      { expectedJobsCount: 3 },
      ({ jobs }) => {
        // @ts-expect-error Job state is not yet reflected in kit types
        expect(jobs.some((job) => job.state !== JobState.STOPPED)).toBeTruthy();
      }
    ));

    it('stop deployment', stopDeployment(deployment));

    it('wait for deployment to be stopped', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.STOPPED }));

    it('check if all jobs are stopped', checkAllJobsStopped(deployment));
  });
}
