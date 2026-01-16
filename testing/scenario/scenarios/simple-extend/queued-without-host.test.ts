import { Deployment } from '@nosana/api';
import { DeploymentStatus, DeploymentStrategy, JobState } from '@nosana/kit';

import { createState, createFlow } from '../../utils/index.js';
import { checkAllJobsStopped, checkDeploymentsJobs, checkNoDeploymentExtendTask, checkSufficientVaultBalance, createDeployment, startDeployment, stopDeployment, waitForDeploymentStatus, waitForJobState, waitForSeconds } from '../../common/index.js';
import { testRunId } from "../../setup.js";

createFlow('Queued Without Host', (step) => {
  const deployment = createState<Deployment>();
  const firstJob = createState<string>();

  step('creates deployment with SIMPLE-EXTEND strategy', createDeployment(
    deployment,
    {
      name: `${testRunId} :: Scenario testing: simple-extend > queued without host`,
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

  step('wait a bit to ensure no extend task is scheduled', waitForSeconds(5));

  step('verify no extend task was scheduled', checkNoDeploymentExtendTask(deployment, { job: firstJob }));

  step('stop deployment', stopDeployment(deployment));

  step('wait for deployment to be stopped', waitForDeploymentStatus(
    deployment, { expectedStatus: DeploymentStatus.STOPPED }
  ));

  step('check if all jobs are stopped', checkAllJobsStopped(deployment));
});

