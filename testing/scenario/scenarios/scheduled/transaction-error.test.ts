import { Deployment } from '@nosana/api';
import { DeploymentStatus, DeploymentStrategy } from '@nosana/kit';

import { createState, createFlow } from '../../utils/index.js';
import {
  checkAllJobsStopped,
  checkDeploymentJobs,
  checkSufficientVaultBalance,
  createDeployment,
  startDeployment,
  stopDeployment,
  topupVault,
  waitForDeploymentStatus,
  waitForSeconds,
  withdrawFundsFromVault
} from '../../common/index.js';
import { providedVaultAddress, testRunId } from "../../setup.js";

const ONE_MINUTE_IN_SECONDS = 60;

if(!providedVaultAddress || providedVaultAddress === "undefined") {
  // This test requires control over the vault to create a transaction error
  createFlow('Transaction Error', (step) => {
    const deployment = createState<Deployment>();
    const firstJob = createState<string>();

    step('creates deployment with SCHEDULED strategy', async () => {
      await createDeployment(
        deployment,
        {
          name: `${testRunId} :: Scenario testing: scheduled > transaction error`,
          strategy: DeploymentStrategy.SCHEDULED,
          schedule: '*/1 * * * *', // every minute
        },
      )();
    });

    step('check vault has sufficient funds', checkSufficientVaultBalance(deployment));

    step('start deployment', startDeployment(deployment));

    step('wait for deployment to be running', waitForDeploymentStatus(deployment, {expectedStatus: DeploymentStatus.RUNNING}));

    step('wait for first job to be posted', checkDeploymentJobs(
      deployment,
      {expectedJobsCount: 1},
      ({jobs}) => firstJob.set(jobs[0].job)
    ));

    step('withdraw funds from vault to create a transaction error', withdrawFundsFromVault());

    step('wait for 1 minute to allow schedule to repeat', waitForSeconds(ONE_MINUTE_IN_SECONDS));

    step('no more jobs should have been posted', checkDeploymentJobs(
      deployment,
      {expectedJobsCount: 1}
    ));

    step('wait for deployment to be in error', waitForDeploymentStatus(deployment, {expectedStatus: DeploymentStatus.ERROR}));

    step("topup vault", topupVault())

    step('stop deployment', stopDeployment(deployment));

    step('wait for deployment to be stopped', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.STOPPED }));

    step('check if all jobs are stopped', checkAllJobsStopped(deployment));
  });
}