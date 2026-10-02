import { Deployment } from '@nosana/api';
import { DeploymentStatus, DeploymentStrategy, JobState } from '@nosana/kit';

import { createState, createFlow } from '../../utils/index.js';
import {
  checkAllJobsStopped,
  checkDeploymentJobs,
  checkSufficientVaultBalance,
  createDeployment,
  startDeployment,
  stopDeployment,
  waitForDeploymentStatus,
  waitForSeconds,
  finishJob,
  joinMarketQueue,
  waitForJobState,
} from '../../common/index.js';
import { testRunId } from "../../setup.js";

const ONE_MINUTE_IN_SECONDS = 60;
createFlow('Schedule repeats', (step) => {
  const deployment = createState<Deployment>();
  const firstJob = createState<string>();

  step('creates deployment with SCHEDULED strategy', async () => {
    await createDeployment(
      deployment,
      {
        name: `${testRunId} :: Scenario testing: scheduled > schedule repeats`,
        strategy: DeploymentStrategy.SCHEDULED,
        schedule: '*/1 * * * *', // every minute
      },
    )();
  });

  step('check vault has sufficient funds', checkSufficientVaultBalance(deployment));

  step('join market queue before starting deployment', joinMarketQueue(() => deployment.get().market));

  step('start deployment', startDeployment(deployment));

  step('wait for deployment to be running', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.RUNNING }));

  step('wait for first job to be posted', checkDeploymentJobs(
    deployment,
    { expectedJobsCount: 1 },
    ({ jobs }) => firstJob.set(jobs[0].job)
  ));

  // One node runs one job at a time: it must finish and rejoin the queue to be
  // assigned the next tick's job.
  step('wait for first job to be running', waitForJobState(firstJob, { expectedState: JobState.RUNNING }));

  step('node finishes the first job', finishJob(() => firstJob.get()));

  step('node rejoins the market queue', joinMarketQueue(() => deployment.get().market));

  step('wait for 1 minute to allow schedule to repeat', waitForSeconds(ONE_MINUTE_IN_SECONDS));

  step('wait for second job to be posted', checkDeploymentJobs(
    deployment,
    { expectedJobsCount: 2 }
  ));

  step('stop deployment', stopDeployment(deployment));

  step('wait for deployment to be stopped', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.STOPPED }));

  step('check if all jobs are stopped', checkAllJobsStopped(deployment));
});
