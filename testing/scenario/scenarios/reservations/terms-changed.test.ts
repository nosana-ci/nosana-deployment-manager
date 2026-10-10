import { expect } from 'vitest';
import { Deployment, NosanaApi } from '@nosana/kit';
import { DeploymentStatus, DeploymentStrategy } from '@nosana/kit';

import { createState, createFlow } from '../../utils/index.js';
import { hostManagerMock, requestingTasks } from '../../mocks/hostManagerMock.js';
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

// host-manager answers 409: the request's key was used with other terms (the
// deployment's market or requirements changed while it waited). That is not an
// error: the LIST hands its job straight away to a new LIST task, whose own
// request (a new key) gets the node.
createFlow('Request Terms Changed', (step) => {
  const deployment = createState<Deployment>();
  const firstJob = createState<string>();

  step('fresh host-manager mock (flows share one when run together)', async () => {
    await hostManagerMock.reset();
  });

  step('creates deployment with SIMPLE strategy', createDeployment(deployment, {
    name: 'Scenario testing: reservations > terms changed',
    strategy: DeploymentStrategy.SIMPLE,
  }));

  step('check vault has sufficient funds', checkSufficientVaultBalance(deployment));

  step('node joins the market queue', joinMarketQueue(() => deployment.get().market));

  step('the first request answers 409', planReservations([
    { status: 409, message: 'Request was made with other terms' },
  ]));

  step('start deployment', startDeployment(deployment));

  step('the hand-off posts the job', checkDeploymentJobs(
    deployment,
    { expectedJobsCount: 1 },
    ({ jobs }) => firstJob.set(jobs[0].job)
  ));

  step('the job is assigned to our node', verifyJobAssignedToNode(() => firstJob.get()));

  step('a new LIST task made the second request, with no cooldown in between', waitForReservations({ count: 2 }, (calls) => {
    expect(requestingTasks(calls)).toEqual(['task:1', 'task:2']);
    expect(new Date(calls[1].at).getTime() - new Date(calls[0].at).getTime()).toBeLessThan(20_000);
  }));

  step('a terms change is not an error', async () => {
    const current = await (deployerClient.api as NosanaApi).deployments.get(deployment.get().id);
    const { events } = await current.getEvents();
    expect(events.map((event) => event.type)).not.toContain('JOB_LIST_ERROR');
  });

  step('stop deployment', stopDeployment(deployment));

  step('wait for deployment to be stopped', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.STOPPED }));

  step('check if all jobs are stopped', checkAllJobsStopped(deployment));
});
