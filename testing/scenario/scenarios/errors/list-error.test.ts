import { Deployment, DeploymentStatus } from "@nosana/kit";

import { createFlow, createState } from "../../utils/index.js";
import { createDeployment, waitForDeploymentEvent, waitForDeploymentHasTask, startDeployment, waitForDeploymentStatus } from "../../common/index.js";
import { TaskType } from "../../../../src/types/index.js";

// NOTE: a transient list failure now RETRIES (escalating cooldown) instead of
// flipping the deployment to terminal ERROR. For a fast targeted run, start the
// DM with a small RETRY_COOLDOWN_BASE_MS (e.g. 2000).
//   npm run test:scenarios -- errors list-error
createFlow('List Error', (step) => {
  const deployment = createState<Deployment>();

  step("create deployment with invalid market", createDeployment(deployment, {
    name: `Error Scenarios > List Error`,
    strategy: 'SCHEDULED',
    schedule: '*/1 * * * *',
    market: "invalid-market"
  }))

  step("start deployment", startDeployment(deployment));

  step("wait for deployment JOB_LIST_ERROR event", waitForDeploymentEvent(deployment, {
    type: "JOB_LIST_ERROR"
  }));

  // New behaviour: a failed LIST keeps the deployment RUNNING and reschedules the
  // task to retry — it is NOT abandoned to ERROR with its task deleted.
  step("deployment stays RUNNING (not ERROR)", waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.RUNNING }));

  step("a LIST retry stays scheduled", waitForDeploymentHasTask(deployment, { task: TaskType.LIST }));
})
