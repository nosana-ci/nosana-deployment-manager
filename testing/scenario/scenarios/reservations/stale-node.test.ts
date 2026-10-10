import { expect } from 'vitest';
import { Deployment } from '@nosana/api';
import { DeploymentStatus, DeploymentStrategy } from '@nosana/kit';
import { generateKeyPairSigner } from '@solana/signers';

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

// host-manager hands out a node that has since left the market queue: the
// assign fails on-chain and the node counts as used. The retry finds the task's
// one fill spent and hands the job to a new LIST task, whose own request gets
// the node that is really queued.
createFlow('Reserved Node No Longer In Queue', (step) => {
  const deployment = createState<Deployment>();
  const firstJob = createState<string>();

  step('creates deployment with SIMPLE strategy', createDeployment(deployment, {
    name: 'Scenario testing: reservations > stale node',
    strategy: DeploymentStrategy.SIMPLE,
  }));

  step('check vault has sufficient funds', checkSufficientVaultBalance(deployment));

  step('node joins the market queue', joinMarketQueue(() => deployment.get().market));

  step('the first reservation returns a node that is not in the queue', async () => {
    const stale = await generateKeyPairSigner();
    await hostManagerMock.plan([{ nodes: [stale.address.toString()] }]);
  });

  step('start deployment', startDeployment(deployment));

  step('assigning the stale node fails', waitForDeploymentEvent(deployment, { type: 'JOB_LIST_ERROR' }));

  step('the retry posts the job', checkDeploymentJobs(
    deployment,
    { expectedJobsCount: 1 },
    ({ jobs }) => firstJob.set(jobs[0].job)
  ));

  step('the job is assigned to the node that is really queued', verifyJobAssignedToNode(() => firstJob.get()));

  step('the stale node was never reused: a new LIST task made a new request', waitForReservations({ count: 2 }, (calls) => {
    expect(requestingTasks(calls)).toEqual(['task:1', 'task:2']);
  }));

  step('stop deployment', stopDeployment(deployment));

  step('wait for deployment to be stopped', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.STOPPED }));

  step('check if all jobs are stopped', checkAllJobsStopped(deployment));
});
