import { Deployment } from '@nosana/api';
import { DeploymentStatus, DeploymentStrategy } from '@nosana/kit';

import { createState, createFlow } from '../../utils/index.js';
import {
  checkDeploymentJobs,
  checkSufficientVaultBalance,
  createDeployment,
  planReservations,
  startDeployment,
  waitForDeploymentEvent,
  waitForDeploymentStatus,
} from '../../common/index.js';

// host-manager rejects the reservation outright (422: the deployment's
// requirements name a metric it does not know). Retrying cannot help, so the
// LIST fails terminally and the deployment is flagged ERROR.
createFlow('Reservation Rejected', (step) => {
  const deployment = createState<Deployment>();

  step('creates deployment with SIMPLE strategy', createDeployment(deployment, {
    name: 'Scenario testing: reservations > reservation rejected',
    strategy: DeploymentStrategy.SIMPLE,
  }));

  step('check vault has sufficient funds', checkSufficientVaultBalance(deployment));

  step('host-manager rejects the requirements with 422', planReservations([
    { status: 422, message: 'Unknown metric "gpu_vram_gb"' },
  ]));

  step('start deployment', startDeployment(deployment));

  step('the rejection is reported', waitForDeploymentEvent(deployment, { type: 'JOB_LIST_ERROR' }));

  step('the deployment is flagged ERROR', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.ERROR }));

  step('no job was posted', checkDeploymentJobs(deployment, { expectedJobsCount: 0 }));
});
