import { expect } from 'vitest';
import { Deployment } from '@nosana/api';
import { DeploymentStatus, DeploymentStrategy } from '@nosana/kit';

import { createState, createFlow } from '../../utils/index.js';
import { requestingTasks } from '../../mocks/hostManagerMock.js';
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

// host-manager answers 503 (its chain read failed): nothing was reserved, so the
// retry re-issues the SAME key — host-manager would replay a reservation that
// did land — and succeeds once host-manager is healthy again.
createFlow('Host-Manager Unavailable', (step) => {
  const deployment = createState<Deployment>();
  const firstJob = createState<string>();

  step('creates deployment with SIMPLE strategy', createDeployment(deployment, {
    name: 'Scenario testing: reservations > host-manager unavailable',
    strategy: DeploymentStrategy.SIMPLE,
  }));

  step('check vault has sufficient funds', checkSufficientVaultBalance(deployment));

  step('node joins the market queue', joinMarketQueue(() => deployment.get().market));

  step('the first reservation request fails with 503', planReservations([
    { status: 503, message: 'Failed to read on-chain market' },
  ]));

  step('start deployment', startDeployment(deployment));

  step('the failed reservation is reported', waitForDeploymentEvent(deployment, { type: 'JOB_LIST_ERROR' }));

  step('the retry posts the job', checkDeploymentJobs(
    deployment,
    { expectedJobsCount: 1 },
    ({ jobs }) => firstJob.set(jobs[0].job)
  ));

  step('the job is assigned to our node', verifyJobAssignedToNode(() => firstJob.get()));

  step('the retry re-issued the same key (same task)', waitForReservations({ count: 2 }, (calls) => {
    expect(requestingTasks(calls)).toEqual(['task:1', 'task:1']);
  }));

  step('stop deployment', stopDeployment(deployment));

  step('wait for deployment to be stopped', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.STOPPED }));

  step('check if all jobs are stopped', checkAllJobsStopped(deployment));
});
