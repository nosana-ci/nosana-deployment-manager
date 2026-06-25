import { Deployment } from '@nosana/api';
import { DeploymentStatus, DeploymentStrategy, JobState } from '@nosana/kit';

import { createFlow, createState } from '../../utils/index.js';
import {
  createDeployment,
  joinMarketQueue,
  startDeployment,
  waitForDeploymentStatus,
  checkDeploymentJobs,
  waitForJobState,
  finishJob,
  waitForDeploymentEvent,
} from '../../common/index.js';

// Mechanism B (ceiling): the throttle escalates, but after RAPID_COMPLETION_MAX_STREAK
// consecutive rapid rounds the deployment is STOPPED to protect funds (the original
// fail-safe, preserved as the final backstop). Run the DM with JOB_COUNT=1 and
// MAX_STREAK=1 so the very first rapid finish hits the ceiling — one finish cycle:
//   RAPID_COMPLETION_JOB_COUNT=1 RAPID_COMPLETION_MAX_STREAK=1 docker compose up -d --build
//   npm run test:scenarios -- rapid-completion ceiling
createFlow('Rapid Completion Ceiling', (step) => {
  const deployment = createState<Deployment>();
  const job = createState<string>();

  step('create INFINITE deployment', createDeployment(deployment, {
    name: 'Rapid Completion > Ceiling',
    strategy: DeploymentStrategy.INFINITE,
    timeout: 60,
    // rotation_time is in MINUTES and must be < timeout - 10 (i.e. < 50 here).
    rotation_time: 40,
  }));

  step('join market queue before starting', joinMarketQueue(() => deployment.get().market));

  step('start deployment', startDeployment(deployment));

  step('wait for deployment to be RUNNING', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.RUNNING }));

  step('wait for first job to be posted', checkDeploymentJobs(
    deployment,
    { expectedJobsCount: 1 },
    ({ jobs }) => job.set(jobs[0].job)
  ));

  step('wait for job to be claimed (RUNNING)', waitForJobState(job, { expectedState: JobState.RUNNING }));

  step('node finishes the job quickly (rapid completion)', finishJob(() => job.get()));

  // With MAX_STREAK=1 the first rapid round hits the ceiling and stops the deployment.
  step('RAPID_COMPLETION_FAIL_SAFE event is emitted', waitForDeploymentEvent(deployment, {
    type: 'RAPID_COMPLETION_FAIL_SAFE'
  }));

  step('deployment is stopped to protect funds', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.STOPPED }));
});
