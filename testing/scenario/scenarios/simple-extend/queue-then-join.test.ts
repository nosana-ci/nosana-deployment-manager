import { Deployment } from '@nosana/api';
import { DeploymentStatus, DeploymentStrategy, JobState } from '@nosana/kit';

import { createState, createFlow } from '../../utils/index.js';
import { checkAllJobsStopped, checkDeploymentsJobs, checkDeploymentExtendTask, checkNoDeploymentExtendTask, checkSufficientVaultBalance, createDeployment, joinMarketQueue, startDeployment, stopDeployment, verifyJobAssignedToNode, waitForDeploymentStatus, waitForJobState, waitForSeconds } from '../../common/index.js';
import { testRunId } from "../../setup.js";

createFlow('Queue Then Join', (step) => {
  const deployment = createState<Deployment>();
  const firstJob = createState<string>();

  step('creates deployment with SIMPLE-EXTEND strategy', createDeployment(
    deployment,
    {
      name: `${testRunId} :: Scenario testing: simple-extend > queue then join`,
      strategy: DeploymentStrategy["SIMPLE-EXTEND"]
    },
  ));

  step('check vault has sufficient funds', checkSufficientVaultBalance(deployment));

  step('start deployment without queueing a node', startDeployment(deployment));

  step('wait for deployment to be running', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.RUNNING }));

  step('wait for first job to be posted', checkDeploymentsJobs(
    deployment,
    { expectedJobsCount: 1 },
    ({ jobs }) => firstJob.set(jobs[0].job)
  ));

  step('wait a bit before queueing a node', waitForSeconds(5));

  step('verify no extend task is scheduled while queued', checkNoDeploymentExtendTask(deployment, { job: firstJob }));

  step('join market queue after job is queued', joinMarketQueue(() => deployment.get().market, { verifyQueued: false }));

  step('wait for job to be running', waitForJobState(firstJob, { expectedState: JobState.RUNNING }));

  step('verify job is assigned to our node', verifyJobAssignedToNode(() => firstJob.get(), { expectedState: 1 }));

  step('wait for extend task to be scheduled', checkDeploymentExtendTask(deployment, { job: firstJob }));

  step('stop deployment', stopDeployment(deployment));

  step('wait for deployment to be stopped', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.STOPPED }));

  step('check if all jobs are stopped', checkAllJobsStopped(deployment));
});


