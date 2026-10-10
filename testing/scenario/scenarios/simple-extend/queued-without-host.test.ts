import { Deployment } from '@nosana/api';
import { DeploymentStatus, DeploymentStrategy } from '@nosana/kit';

import { createState, createFlow } from '../../utils/index.js';
import { TaskType } from '../../../../src/types/index.js';
import {
  checkAllJobsStopped,
  checkDeploymentJobs,
  checkSufficientVaultBalance,
  createDeployment,
  startDeployment,
  stopDeployment,
  waitForDeploymentEvent,
  waitForDeploymentHasTask,
  waitForDeploymentStatus,
} from '../../common/index.js';

// No host ever joins: no job is posted (nothing to assign to), the LIST stays
// parked on a waiting request, no extend is ever scheduled, and the deployment
// can still be stopped cleanly.
createFlow('Queued Without Host', (step) => {
  const deployment = createState<Deployment>();

  step('creates deployment with SIMPLE-EXTEND strategy', createDeployment(
    deployment,
    {
      name: "Scenario testing: simple-extend > queued without host",
      strategy: DeploymentStrategy["SIMPLE-EXTEND"]
    },
  ));

  step('check vault has sufficient funds', checkSufficientVaultBalance(deployment));

  step('start deployment without queueing a node', startDeployment(deployment));

  step('wait for deployment to be running', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.RUNNING }));

  step('the request waits at host-manager', waitForDeploymentEvent(deployment, { type: 'JOB_RESERVE_WAITING' }));

  step('no job is posted', checkDeploymentJobs(deployment, { expectedJobsCount: 0 }));

  step('only the parked LIST is scheduled, no extend', waitForDeploymentHasTask(deployment, { task: TaskType.LIST }, (task) => {
    if (task.task !== TaskType.LIST) throw new Error(`unexpected ${task.task} task`);
  }));

  step('stop deployment', stopDeployment(deployment));

  step('wait for deployment to be stopped', waitForDeploymentStatus(
    deployment, { expectedStatus: DeploymentStatus.STOPPED }
  ));

  step('check if all jobs are stopped', checkAllJobsStopped(deployment));
});
