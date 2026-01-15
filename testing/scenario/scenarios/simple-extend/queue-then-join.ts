import { describe, it } from 'vitest';
import { Deployment } from '@nosana/api';
import { DeploymentStatus, DeploymentStrategy, JobState } from '@nosana/kit';

import { createState } from '../../utils/index.js';
import { checkAllJobsStopped, checkDeploymentsJobs, checkDeploymentExtendTask, checkNoDeploymentExtendTask, checkSufficientVaultBalance, createDeployment, joinMarketQueue, startDeployment, stopDeployment, verifyJobAssignedToNode, waitForDeploymentStatus, waitForJobState, waitForSeconds } from '../../common/index.js';

export function queueThenJoinScenario() {
  describe('Queue Then Join', () => {
    const deployment = createState<Deployment>();
    const firstJob = createState<string>();

    it('creates deployment with SIMPLE-EXTEND strategy', createDeployment(
      deployment,
      { strategy: DeploymentStrategy["SIMPLE-EXTEND"] },
    ));

    it('check vault has sufficient funds', checkSufficientVaultBalance(deployment));

    it('start deployment without queueing a node', startDeployment(deployment));

    it('wait for deployment to be running', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.RUNNING }));

    it('wait for first job to be posted', checkDeploymentsJobs(
      deployment,
      { expectedJobsCount: 1 },
      ({ jobs }) => firstJob.set(jobs[0].job)
    ));

    it('wait a bit before queueing a node', waitForSeconds(5));

    it('verify no extend task is scheduled while queued', checkNoDeploymentExtendTask(deployment, { job: firstJob }));

    it('join market queue after job is queued', joinMarketQueue(() => deployment.get().market, { verifyQueued: false }));

    it('wait for job to be running', waitForJobState(firstJob, { expectedState: JobState.RUNNING }));

    it('verify job is assigned to our node', verifyJobAssignedToNode(() => firstJob.get(), { expectedState: 1 }));

    it('wait for extend task to be scheduled', checkDeploymentExtendTask(deployment, { job: firstJob }));

    it('stop deployment', stopDeployment(deployment));

    it('wait for deployment to be stopped', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.STOPPED }));

    it('check if all jobs are stopped', checkAllJobsStopped(deployment));
  });
}

