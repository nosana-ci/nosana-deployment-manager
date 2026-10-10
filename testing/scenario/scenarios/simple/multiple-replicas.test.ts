import { expect } from 'vitest';
import { Deployment } from '@nosana/api';
import { DeploymentStatus, DeploymentStrategy } from '@nosana/kit';

import { createState, createFlow } from '../../utils/index.js';
import { TaskType } from '../../../../src/types/index.js';
import { requestingTasks } from '../../mocks/hostManagerMock.js';
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

// Three replicas, one queued node: the request is filled partially, so one job
// is assigned now and the other two are handed straight away to a new LIST task,
// whose own request waits at host-manager (it parks) until more nodes queue up.
createFlow('Multiple Replicas', (step) => {
  const deployment = createState<Deployment>();
  const firstJob = createState<string>();

  step('creates deployment with SIMPLE strategy and multiple replicas', createDeployment(
    deployment,
    {
      name: "Scenario testing: simple > multiple replicas",
      strategy: DeploymentStrategy.SIMPLE,
      replicas: 3,
    },
  ));

  step('check vault has sufficient funds', checkSufficientVaultBalance(deployment));

  step('one node joins the market queue', joinMarketQueue(() => deployment.get().market));

  step('start deployment', startDeployment(deployment));

  step('wait for deployment to be running', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.RUNNING }));

  step('one job is posted to the only node', checkDeploymentJobs(
    deployment,
    { expectedJobsCount: 1 },
    ({ jobs }) => firstJob.set(jobs[0].job)
  ));

  step('the job is assigned to our node', verifyJobAssignedToNode(() => firstJob.get()));

  step('the other two replicas are reported as a shortfall', waitForDeploymentEvent(deployment, { type: 'JOB_RESERVE_SHORTFALL' }));

  step('the remainder is requested at once and waits', waitForDeploymentEvent(deployment, { type: 'JOB_RESERVE_WAITING' }));

  step('the LIST stays parked for the remaining replicas', waitForDeploymentHasTask(deployment, { task: TaskType.LIST }));

  step('the first task asked for all three, the hand-off task (its own key) only for the remainder, without a cooldown in between', waitForReservations({ count: 2 }, (calls) => {
    expect(calls.map((call) => call.count)).toEqual([3, 2]);
    expect(requestingTasks(calls)).toEqual(['task:1', 'task:2']);
    // Well under the 30 s retry cooldown a shortfall used to wait out.
    expect(new Date(calls[1].at).getTime() - new Date(calls[0].at).getTime()).toBeLessThan(20_000);
  }));

  step('stop deployment', stopDeployment(deployment));

  step('wait for deployment to be stopped', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.STOPPED }));

  step('check if all jobs are stopped', checkAllJobsStopped(deployment));
});
