import { Deployment } from '@nosana/api';
import { DeploymentStatus, DeploymentStrategy, JobState } from '@nosana/kit';

import { createFlow, createState } from '../../utils/index.js';
import { TaskType } from '../../../../src/types/index.js';
import {
  createDeployment,
  joinMarketQueue,
  startDeployment,
  waitForDeploymentStatus,
  checkDeploymentJobs,
  waitForJobState,
  finishJob,
  waitForDeploymentEvent,
  waitForDeploymentHasTask,
} from '../../common/index.js';

// Mechanism B (throttle): an INFINITE deployment whose jobs complete too fast no
// longer STOPS on the fail-safe — it THROTTLES the next round with an escalating
// cooldown and keeps RUNNING. Run the DM with RAPID_COMPLETION_JOB_COUNT=1 so a
// single fast finish trips the fail-safe (no multi-round cycling needed):
//   RAPID_COMPLETION_JOB_COUNT=1 RAPID_COMPLETION_COOLDOWN_BASE_MS=2000 docker compose up -d --build
//   npm run test:scenarios -- rapid-completion throttle
createFlow('Rapid Completion Throttle', (step) => {
  const deployment = createState<Deployment>();
  const job = createState<string>();

  step('create INFINITE deployment', createDeployment(deployment, {
    name: 'Rapid Completion > Throttle',
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

  // The rapid completion trips the fail-safe, which now throttles instead of stopping.
  step('RAPID_COMPLETION_THROTTLE event is emitted', waitForDeploymentEvent(deployment, {
    type: 'RAPID_COMPLETION_THROTTLE'
  }));

  step('deployment stays RUNNING (throttled, not stopped)', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.RUNNING }));

  step('the next round is scheduled (delayed LIST retry)', waitForDeploymentHasTask(deployment, { task: TaskType.LIST }));
});
