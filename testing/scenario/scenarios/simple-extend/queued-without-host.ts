import { describe, it } from 'vitest';
import { Deployment } from '@nosana/api';
import { DeploymentStatus, DeploymentStrategy, JobState } from '@nosana/kit';

import { createState } from '../../utils/index.js';
import { checkAllJobsStopped, checkDeploymentsJobs, checkNoDeploymentExtendTask, checkSufficientVaultBalance, createDeployment, startDeployment, stopDeployment, waitForDeploymentStatus, waitForJobState, waitForSeconds } from '../../common/index.js';
import {testRunId} from "../../setup";

export function queuedWithoutHostScenario() {
  describe('Queued Without Host', () => {
    const deployment = createState<Deployment>();
    const firstJob = createState<string>();

    it('creates deployment with SIMPLE-EXTEND strategy', createDeployment(
      deployment,
      {
        name: `${testRunId} :: Scenario testing: simple-extend > queued without host`,
        strategy: DeploymentStrategy["SIMPLE-EXTEND"]
      },
    ));

    it('check vault has sufficient funds', checkSufficientVaultBalance(deployment));

    it('start deployment without queueing a node', startDeployment(deployment));

    it('wait for deployment to be running', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.RUNNING }));

    it('wait for first job to be posted', checkDeploymentsJobs(
      deployment,
      { expectedJobsCount: 1 },
      ({ jobs }) => firstJob.set(jobs[0].job)
    ));

    it('wait a bit to ensure no extend task is scheduled', waitForSeconds(5));

    it('verify no extend task was scheduled', checkNoDeploymentExtendTask(deployment, { job: firstJob }));

    it('stop deployment', stopDeployment(deployment));

    it('wait for deployment to be stopped', waitForDeploymentStatus(
      deployment, { expectedStatus: DeploymentStatus.STOPPED }
    ));

    it('check if all jobs are stopped', checkAllJobsStopped(deployment));
  });
}

