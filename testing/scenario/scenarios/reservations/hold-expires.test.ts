import { expect } from 'vitest';
import { Deployment } from '@nosana/api';
import { DeploymentStatus, DeploymentStrategy } from '@nosana/kit';

import { createState, createFlow } from '../../utils/index.js';
import { reservationEpochs } from '../../mocks/hostManagerMock.js';
import {
  checkAllJobsStopped,
  checkDeploymentJobs,
  checkSufficientVaultBalance,
  createDeployment,
  joinMarketQueue,
  planReservations,
  startDeployment,
  stopDeployment,
  verifyJobAssignedToNode,
  waitForDeploymentEvent,
  waitForDeploymentStatus,
  waitForReservations,
} from '../../common/index.js';

// The reserved node could not be signed for (an unusable address, so nothing was
// recorded against it) and the hold lapses before the retry: a lapsed hold is
// never reused, so the retry reserves afresh under the next epoch.
// Needs the DM retry cooldown to be longer than the 1 s hold (it always is).
createFlow('Hold Expires Before The Retry', (step) => {
  const deployment = createState<Deployment>();
  const firstJob = createState<string>();

  step('creates deployment with SIMPLE strategy', createDeployment(deployment, {
    name: 'Scenario testing: reservations > hold expires',
    strategy: DeploymentStrategy.SIMPLE,
  }));

  step('check vault has sufficient funds', checkSufficientVaultBalance(deployment));

  step('node joins the market queue', joinMarketQueue(() => deployment.get().market));

  step('the first reservation holds an unusable node for one second', planReservations([
    { nodes: ['not-a-node-address'], expiresInMs: 1_000 },
  ]));

  step('start deployment', startDeployment(deployment));

  step('the first attempt fails to sign', waitForDeploymentEvent(deployment, { type: 'JOB_LIST_ERROR' }));

  step('the retry posts the job', checkDeploymentJobs(
    deployment,
    { expectedJobsCount: 1 },
    ({ jobs }) => firstJob.set(jobs[0].job)
  ));

  step('the job is assigned to our node', verifyJobAssignedToNode(() => firstJob.get()));

  step('the lapsed hold was not reused: the retry reserved under the next epoch', waitForReservations({ count: 2 }, (calls) => {
    expect(reservationEpochs(calls)).toEqual(['reserve:0', 'reserve:1']);
  }));

  step('stop deployment', stopDeployment(deployment));

  step('wait for deployment to be stopped', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.STOPPED }));

  step('check if all jobs are stopped', checkAllJobsStopped(deployment));
});
