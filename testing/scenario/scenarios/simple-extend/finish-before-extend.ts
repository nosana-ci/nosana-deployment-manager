import { describe, it, expect } from 'vitest';
import { Deployment } from '@nosana/api';
import { DeploymentStatus, DeploymentStrategy, JobState } from '@nosana/kit';

import { createState } from '../../utils/index.js';
import { checkAllJobsStopped, checkDeploymentExtendTask, checkDeploymentsJobs, checkSufficientVaultBalance, createDeployment, finishJob, joinMarketQueue, startDeployment, verifyJobAssignedToNode, waitForDeploymentStatus, waitForJobState } from '../../common/index.js';

export function finishBeforeExtendScenario() {
  describe('Simple Extend Deployment Strategy - Finish Before Extend', () => {
    const deployment = createState<Deployment>();
    const firstJob = createState<string>();

    it('creates deployment with SIMPLE-EXTEND strategy', createDeployment(
      deployment,
      { strategy: DeploymentStrategy["SIMPLE-EXTEND"] },
    ));

    it('check vault has sufficient funds', checkSufficientVaultBalance(deployment));

    it('join market queue before starting deployment', joinMarketQueue(() => deployment.get().market));

    it('start deployment', startDeployment(deployment));

    it('wait for deployment to be running', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.RUNNING }));

    it('wait for first job to be posted', checkDeploymentsJobs(
      deployment,
      { expectedJobsCount: 1 },
      ({ jobs }) => firstJob.set(jobs[0].job)
    ));

    it('wait for first job to be running', waitForJobState(firstJob, { expectedState: JobState.RUNNING }));

    it('verify job is assigned to our node', verifyJobAssignedToNode(() => firstJob.get(), { expectedState: 1 }));

    it('wait for extend task to be scheduled', checkDeploymentExtendTask(deployment, { job: firstJob }));

    it('finish job before extend executes', finishJob(() => firstJob.get()));

    it('wait for deployment to be stopped and tasks removed', waitForDeploymentStatus(
      deployment, { expectedStatus: DeploymentStatus.STOPPED },
      async () => {
        const tasks = await deployment.get().getTasks();
        expect(tasks.length).toBe(0);
      }
    ));

    it('check if all jobs are stopped', checkAllJobsStopped(deployment));
  });
}

