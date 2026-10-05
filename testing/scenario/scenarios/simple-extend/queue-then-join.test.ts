import { Deployment } from '@nosana/api';
import { DeploymentStatus, DeploymentStrategy, JobState } from '@nosana/kit';

import { createState, createFlow } from '../../utils/index.js';
import {
  checkAllJobsStopped,
  checkDeploymentExtendTask,
  checkDeploymentJobs,
  checkSufficientVaultBalance,
  createDeployment,
  joinMarketQueue,
  startDeployment,
  stopDeployment,
  verifyJobAssignedToNode,
  waitForDeploymentEvent,
  waitForDeploymentStatus,
  waitForJobState,
} from '../../common/index.js';

// Started before any node is queued: nothing can be assigned, so the LIST waits
// (shortfall). Once the node joins, the retry assigns the job and the extend
// cycle starts.
createFlow('Queue Then Join', (step) => {
  const deployment = createState<Deployment>();
  const firstJob = createState<string>();

  step('creates deployment with SIMPLE-EXTEND strategy', createDeployment(
    deployment,
    {
      name: "Scenario testing: simple-extend > queue then join",
      strategy: DeploymentStrategy["SIMPLE-EXTEND"]
    },
  ));

  step('check vault has sufficient funds', checkSufficientVaultBalance(deployment));

  step('start deployment without queueing a node', startDeployment(deployment));

  step('wait for deployment to be running', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.RUNNING }));

  step('no node to assign: the reservation is a shortfall', waitForDeploymentEvent(deployment, { type: 'JOB_RESERVE_SHORTFALL' }));

  step('no job is posted while nothing is queued', checkDeploymentJobs(deployment, { expectedJobsCount: 0 }));

  step('join market queue', joinMarketQueue(() => deployment.get().market, { verifyQueued: false }));

  step('the retry posts the job', checkDeploymentJobs(
    deployment,
    { expectedJobsCount: 1 },
    ({ jobs }) => firstJob.set(jobs[0].job)
  ));

  step('wait for job to be running', waitForJobState(firstJob, { expectedState: JobState.RUNNING }));

  step('verify job is assigned to our node', verifyJobAssignedToNode(() => firstJob.get(), { expectedState: 1 }));

  step('wait for extend task to be scheduled', checkDeploymentExtendTask(deployment, { job: firstJob }));

  step('stop deployment', stopDeployment(deployment));

  step('wait for deployment to be stopped', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.STOPPED }));

  step('check if all jobs are stopped', checkAllJobsStopped(deployment));
});
