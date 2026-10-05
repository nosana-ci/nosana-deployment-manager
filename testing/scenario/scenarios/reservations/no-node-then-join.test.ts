import { expect } from 'vitest';
import { Deployment } from '@nosana/api';
import { DeploymentStatus, DeploymentStrategy } from '@nosana/kit';

import { createState, createFlow } from '../../utils/index.js';
import { reservationEpochs } from '../../mocks/hostManagerMock.js';
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

// No node is queued when the deployment starts: the reservation comes back
// empty, the LIST waits (shortfall, retry scheduled), and once a node joins the
// next attempt reserves under a fresh key and assigns the job to it.
createFlow('No Node Queued, Then One Joins', (step) => {
  const deployment = createState<Deployment>();
  const firstJob = createState<string>();

  step('creates deployment with SIMPLE strategy', createDeployment(deployment, {
    name: 'Scenario testing: reservations > no node then join',
    strategy: DeploymentStrategy.SIMPLE,
  }));

  step('check vault has sufficient funds', checkSufficientVaultBalance(deployment));

  step('start deployment with no node in the queue', startDeployment(deployment));

  step('the empty reservation is reported as a shortfall', waitForDeploymentEvent(deployment, { type: 'JOB_RESERVE_SHORTFALL' }));

  step('no job is posted and a LIST retry stays scheduled', async () => {
    await checkDeploymentJobs(deployment, { expectedJobsCount: 0 })();
    await waitForDeploymentHasTask(deployment, { task: TaskType.LIST })();
  });

  step('the reservation carried the shared key, the market and the replica count', waitForReservations({ count: 1 }, (calls) => {
    expect(calls[0]).toMatchObject({
      authorization: process.env.HOST_MANAGER_MOCK_KEY,
      market: deployment.get().market,
      count: 1,
    });
  }));

  step('node joins the market queue', joinMarketQueue(() => deployment.get().market, { verifyQueued: false }));

  step('the next attempt posts the job', checkDeploymentJobs(
    deployment,
    { expectedJobsCount: 1 },
    ({ jobs }) => firstJob.set(jobs[0].job)
  ));

  step('the job is assigned to our node', verifyJobAssignedToNode(() => firstJob.get()));

  step('the empty hold was not reused: the second attempt reserved under the next epoch', waitForReservations({ count: 2 }, (calls) => {
    expect(reservationEpochs(calls)).toEqual(['reserve:0', 'reserve:1']);
  }));

  step('stop deployment', stopDeployment(deployment));

  step('wait for deployment to be stopped', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.STOPPED }));

  step('check if all jobs are stopped', checkAllJobsStopped(deployment));
});
