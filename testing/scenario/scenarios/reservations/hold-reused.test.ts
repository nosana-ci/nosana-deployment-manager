import { expect } from 'vitest';
import { Deployment } from '@nosana/api';
import { DeploymentStatus, DeploymentStrategy } from '@nosana/kit';

import { createState, createFlow } from '../../utils/index.js';
import { hostManagerMock } from '../../mocks/hostManagerMock.js';
import {
  checkDeploymentJobs,
  checkSufficientVaultBalance,
  createDeployment,
  planReservations,
  startDeployment,
  stopDeployment,
  waitForDeploymentEvent,
  waitForDeploymentStatus,
} from '../../common/index.js';

// The counterpart of hold-expires: while the hold is live and its node is still
// unused, a retry reuses the recorded reservation instead of asking host-manager
// again — so every retry fails the same way and no second reservation is made.
createFlow('Live Hold Is Reused On Retry', (step) => {
  const deployment = createState<Deployment>();

  step('creates deployment with SIMPLE strategy', createDeployment(deployment, {
    name: 'Scenario testing: reservations > hold reused',
    strategy: DeploymentStrategy.SIMPLE,
  }));

  step('check vault has sufficient funds', checkSufficientVaultBalance(deployment));

  step('the reservation holds an unusable node for ten minutes', planReservations([
    { nodes: ['not-a-node-address'], expiresInMs: 10 * 60_000 },
  ]));

  step('start deployment', startDeployment(deployment));

  step('two attempts fail to sign', waitForDeploymentEvent(deployment, { type: 'JOB_LIST_ERROR' }, { atLeast: 2 }));

  step('host-manager was asked once: the live hold was reused', async () => {
    expect(await hostManagerMock.calls()).toHaveLength(1);
  });

  step('no job was posted', checkDeploymentJobs(deployment, { expectedJobsCount: 0 }));

  step('stop deployment', stopDeployment(deployment));

  step('wait for deployment to be stopped', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.STOPPED }));
});
