import { expect } from 'vitest';
import { Deployment } from '@nosana/api';
import { DeploymentStatus, DeploymentStrategy } from '@nosana/kit';

import { createState, createFlow } from '../../utils/index.js';
import { hostManagerMock } from '../../mocks/hostManagerMock.js';
import {
  checkDeploymentJobs,
  checkSufficientVaultBalance,
  createDeployment,
  startDeployment,
  stopDeployment,
  waitForDeploymentEvent,
  waitForDeploymentHasNoTasks,
  waitForDeploymentStatus,
  waitForReservations,
} from '../../common/index.js';

// Stopping a deployment whose LIST waits on host-manager cancels the request,
// so host-manager stops looking for nodes for it instead of waiting for expiry.
createFlow('Waiting Request Cancelled On Stop', (step) => {
  const deployment = createState<Deployment>();
  const requestKey = createState<string>();

  step('fresh host-manager mock (flows share one when run together)', async () => {
    await hostManagerMock.reset();
  });

  step('creates deployment with SIMPLE strategy', createDeployment(deployment, {
    name: 'Scenario testing: reservations > cancel on stop',
    strategy: DeploymentStrategy.SIMPLE,
  }));

  step('check vault has sufficient funds', checkSufficientVaultBalance(deployment));

  step('start deployment with no node in the queue', startDeployment(deployment));

  step('the request is reported as waiting', waitForDeploymentEvent(deployment, { type: 'JOB_RESERVE_WAITING' }));

  step('remember the waiting request', waitForReservations({ count: 1 }, (calls) => {
    requestKey.set(calls[0].key);
  }));

  step('stop deployment', stopDeployment(deployment));

  step('wait for deployment to be stopped', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.STOPPED }));

  step('the parked LIST is gone', waitForDeploymentHasNoTasks(deployment));

  step('the waiting request was cancelled at host-manager', async () => {
    await expect.poll(() => hostManagerMock.cancels(), { message: 'Waiting for the DM to cancel the request' })
      .toContain(requestKey.get());
  });

  step('no job was posted', checkDeploymentJobs(deployment, { expectedJobsCount: 0 }));
});
