import { expect } from 'vitest';
import { Deployment } from '@nosana/api';
import { DeploymentStatus, DeploymentStrategy } from '@nosana/kit';

import { createState, createFlow } from '../../utils/index.js';
import { TaskType } from '../../../../src/types/index.js';
import {
  checkAllJobsStopped,
  checkDeploymentJobs,
  checkSufficientVaultBalance,
  createDeployment,
  joinMarketQueue,
  startDeployment,
  stopDeployment,
  verifyJobAssignedToNode,
  waitForDeploymentEvent,
  waitForDeploymentHasTask,
  waitForDeploymentStatus,
  waitForReservations,
} from '../../common/index.js';

// Three replicas, one queued node: the reservation is partial, so one job is
// assigned now and the LIST keeps retrying for the other two until more nodes
// queue up.
createFlow('Multiple Replicas', (step) => {
  const deployment = createState<Deployment>();
  const firstJob = createState<string>();

  step('creates deployment with SIMPLE strategy and multiple replicas', createDeployment(
    deployment,
    {
      name: "Scenario testing: simple > multiple replicas",
      strategy: DeploymentStrategy.SIMPLE,
      replicas: 3,
    },
  ));

  step('check vault has sufficient funds', checkSufficientVaultBalance(deployment));

  step('one node joins the market queue', joinMarketQueue(() => deployment.get().market));

  step('start deployment', startDeployment(deployment));

  step('wait for deployment to be running', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.RUNNING }));

  step('one job is posted to the only node', checkDeploymentJobs(
    deployment,
    { expectedJobsCount: 1 },
    ({ jobs }) => firstJob.set(jobs[0].job)
  ));

  step('the job is assigned to our node', verifyJobAssignedToNode(() => firstJob.get()));

  step('the other two replicas are reported as a shortfall', waitForDeploymentEvent(deployment, { type: 'JOB_RESERVE_SHORTFALL' }));

  step('a LIST retry stays scheduled for the remaining replicas', waitForDeploymentHasTask(deployment, { task: TaskType.LIST }));

  step('the first reservation asked for all three, the retry only for the shortfall', waitForReservations({ count: 2 }, (calls) => {
    expect(calls.map((call) => call.count)).toEqual([3, 2]);
  }));

  step('stop deployment', stopDeployment(deployment));

  step('wait for deployment to be stopped', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.STOPPED }));

  step('check if all jobs are stopped', checkAllJobsStopped(deployment));
});
