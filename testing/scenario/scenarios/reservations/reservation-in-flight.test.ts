import { expect } from 'vitest';
import { Deployment, NosanaApi } from '@nosana/kit';
import { DeploymentStatus, DeploymentStrategy } from '@nosana/kit';

import { createState, createFlow } from '../../utils/index.js';
import { reservationEpochs } from '../../mocks/hostManagerMock.js';
import { deployerClient } from '../../setup.js';
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
  waitForDeploymentStatus,
  waitForReservations,
} from '../../common/index.js';

// host-manager answers 409: the same key is still being processed (a lost
// response from a previous attempt). That is a wait, not an error — the DM
// re-polls the same key shortly after and no error event is emitted.
createFlow('Reservation Still In Flight', (step) => {
  const deployment = createState<Deployment>();
  const firstJob = createState<string>();

  step('creates deployment with SIMPLE strategy', createDeployment(deployment, {
    name: 'Scenario testing: reservations > reservation in flight',
    strategy: DeploymentStrategy.SIMPLE,
  }));

  step('check vault has sufficient funds', checkSufficientVaultBalance(deployment));

  step('node joins the market queue', joinMarketQueue(() => deployment.get().market));

  step('the first reservation request answers 409', planReservations([
    { status: 409, message: 'Reservation in progress' },
  ]));

  step('start deployment', startDeployment(deployment));

  step('the re-poll posts the job', checkDeploymentJobs(
    deployment,
    { expectedJobsCount: 1 },
    ({ jobs }) => firstJob.set(jobs[0].job)
  ));

  step('the job is assigned to our node', verifyJobAssignedToNode(() => firstJob.get()));

  step('the re-poll used the same key', waitForReservations({ count: 2 }, (calls) => {
    expect(reservationEpochs(calls)).toEqual(['reserve:0', 'reserve:0']);
  }));

  step('an in-flight wait is not an error', async () => {
    const current = await (deployerClient.api as NosanaApi).deployments.get(deployment.get().id);
    const { events } = await current.getEvents();
    expect(events.map((event) => event.type)).not.toContain('JOB_LIST_ERROR');
  });

  step('stop deployment', stopDeployment(deployment));

  step('wait for deployment to be stopped', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.STOPPED }));

  step('check if all jobs are stopped', checkAllJobsStopped(deployment));
});
