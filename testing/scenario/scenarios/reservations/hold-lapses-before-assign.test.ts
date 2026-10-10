import { expect } from 'vitest';
import { Deployment } from '@nosana/api';
import { DeploymentStatus, DeploymentStrategy, NosanaApi } from '@nosana/kit';

import { createState, createFlow } from '../../utils/index.js';
import { deployerClient } from '../../setup.js';
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

// The webhook arrives but the hold it reports has already lapsed (the DM was
// too slow to assign). A lapsed hold is never assigned: the LIST hands the job
// to a new LIST task (after the retry cooldown) with a request of its own,
// which the node fills once it joins.
createFlow('Hold Lapses Before Assign', (step) => {
  const deployment = createState<Deployment>();
  const firstJob = createState<string>();

  step('fresh host-manager mock (flows share one when run together)', async () => {
    await hostManagerMock.reset();
  });

  step('creates deployment with SIMPLE strategy', createDeployment(deployment, {
    name: 'Scenario testing: reservations > hold lapses before assign',
    strategy: DeploymentStrategy.SIMPLE,
  }));

  step('check vault has sufficient funds', checkSufficientVaultBalance(deployment));

  step('start deployment with no node in the queue', startDeployment(deployment));

  step('the request is reported as waiting', waitForDeploymentEvent(deployment, { type: 'JOB_RESERVE_WAITING' }));

  step('host-manager delivers a fill whose hold has already lapsed', async () => {
    const node = deployerClient.wallet!.address.toString();
    await hostManagerMock.fulfil({ nodes: [node], holdMs: -1_000 });
    await expect.poll(async () => (await hostManagerMock.deliveries()).map((delivery) => delivery.status)).toEqual([200]);
  });

  step("the lapsed hold is not assigned: a new LIST task's request waits instead", waitForReservations({ count: 2 }, (calls) => {
    expect(requestingTasks(calls)).toEqual(['task:1', 'task:2']);
  }));

  step('node joins the market queue (host-manager fills the new request)', joinMarketQueue(() => deployment.get().market, { verifyQueued: false }));

  step('the job is posted', checkDeploymentJobs(
    deployment,
    { expectedJobsCount: 1 },
    ({ jobs }) => firstJob.set(jobs[0].job)
  ));

  step('the job is assigned to our node', verifyJobAssignedToNode(() => firstJob.get()));

  step('nothing was ever assigned from the lapsed hold', async () => {
    const current = await (deployerClient.api as NosanaApi).deployments.get(deployment.get().id);
    const { events } = await current.getEvents();
    expect(events.map((event) => event.type)).not.toContain('JOB_LIST_ERROR');
  });

  step('stop deployment', stopDeployment(deployment));

  step('wait for deployment to be stopped', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.STOPPED }));

  step('check if all jobs are stopped', checkAllJobsStopped(deployment));
});
