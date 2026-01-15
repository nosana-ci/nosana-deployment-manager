import { describe, it, expect } from 'vitest';
import { Deployment } from '@nosana/api';
import { address, DeploymentStatus, DeploymentStrategy, JobState } from '@nosana/kit';

import { createState } from '../../utils/index.js';
import { createDeployment, checkDeploymentsJobs, checkSufficientVaultBalance, waitForDeploymentStatus, startDeployment, waitForJobState, checkDeploymentExtendTask, waitForTaskComplete, checkJobsTimeout, finishJob, joinMarketQueue, verifyJobAssignedToNode, checkAllJobsStopped } from '../../common/index.js';
import {deployerClient, testRunId} from '../../setup.js';

export function basicFlowScenario() {
  describe('Basic Flow', () => {
    const deployment = createState<Deployment>();
    const firstJob = createState<string>();

    it('creates deployment with SIMPLE-EXTEND strategy', createDeployment(
      deployment,
      {
        name: `${testRunId} :: Scenario testing: simple-extend > basic flow`,
        strategy: DeploymentStrategy["SIMPLE-EXTEND"],
        timeout: 1.5
      },
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

    it('wait for extend task to be scheduled', checkDeploymentExtendTask(deployment, { job: firstJob },
      async (task) => {
        const jobDetails = await deployerClient.jobs.get(address(firstJob.get()));
        const expectedDueAtMs = (Number(jobDetails!.timeStart) + Number(jobDetails!.timeout) - 60) * 1000;
        const actualDueAtMs = new Date(task!.due_at).getTime();
        expect(Math.abs(actualDueAtMs - expectedDueAtMs)).toBeLessThan(5000);
      }
    ));

    it('wait for extend task to execute (<= 2 minutes)', waitForTaskComplete(deployment));

    it('validate job has been extended', checkJobsTimeout(deployment, () => firstJob.get()));

    it('wait for extend task to be scheduled', checkDeploymentExtendTask(deployment, { job: firstJob }));

    it('verify first job is assigned to our node', verifyJobAssignedToNode(() => firstJob.get(), { expectedState: 1 }));

    it('finish first job prematurely', finishJob(() => firstJob.get()));

    it('wait for deployment to be stopped', waitForDeploymentStatus(
      deployment, { expectedStatus: DeploymentStatus.STOPPED },
      async () => {
        const tasks = await deployment.get().getTasks();
        expect(tasks.length).toBe(0);
      }
    ));

    it('check if all jobs are stopped', checkAllJobsStopped(deployment));
  });
}
