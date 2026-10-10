import { expect } from 'vitest';
import { Deployment } from '@nosana/api';
import { DeploymentStatus, DeploymentStrategy } from '@nosana/kit';

import { createState, createFlow } from '../../utils/index.js';
import { hostManagerMock, requestingTasks } from '../../mocks/hostManagerMock.js';
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
  waitForDeploymentStatus,
  waitForReservations,
} from '../../common/index.js';

// host-manager fills the waiting request but its webhook never arrives. The
// parked LIST renews the same request when it is due and host-manager replays
// the fulfilment, so the job is still assigned.
// Needs the DM to renew quickly: run it with RESERVATION_RENEW_MS=10000.
createFlow('Missed Webhook Recovered By Renewal', (step) => {
  const deployment = createState<Deployment>();
  const firstJob = createState<string>();

  step('fresh host-manager mock (flows share one when run together)', async () => {
    await hostManagerMock.reset();
  });

  step('creates deployment with SIMPLE strategy', createDeployment(deployment, {
    name: 'Scenario testing: reservations > missed webhook',
    strategy: DeploymentStrategy.SIMPLE,
  }));

  step('check vault has sufficient funds', checkSufficientVaultBalance(deployment));

  step('host-manager will fill requests without calling the webhook', async () => {
    await hostManagerMock.webhooks(false);
  });

  step('start deployment with no node in the queue', startDeployment(deployment));

  step('the request is reported as waiting', waitForDeploymentEvent(deployment, { type: 'JOB_RESERVE_WAITING' }));

  step('node joins the market queue (the request is filled silently)', joinMarketQueue(() => deployment.get().market, { verifyQueued: false }));

  step('the renewal posts the job', checkDeploymentJobs(
    deployment,
    { expectedJobsCount: 1 },
    ({ jobs }) => firstJob.set(jobs[0].job)
  ));

  step('the job is assigned to our node', verifyJobAssignedToNode(() => firstJob.get()));

  step('the renewal came from the same task (same key)', waitForReservations({ count: 2 }, (calls) => {
    expect(requestingTasks(calls).slice(0, 2)).toEqual(['task:1', 'task:1']);
  }));

  step('no webhook was sent', async () => {
    expect(await hostManagerMock.deliveries()).toEqual([]);
  });

  step('stop deployment', stopDeployment(deployment));

  step('wait for deployment to be stopped', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.STOPPED }));

  step('check if all jobs are stopped', checkAllJobsStopped(deployment));

  step('webhooks back on for the flows after this one', async () => {
    await hostManagerMock.webhooks(true);
  });
});
