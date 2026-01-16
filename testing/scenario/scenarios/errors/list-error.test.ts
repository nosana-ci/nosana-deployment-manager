import { Deployment, DeploymentStatus } from "@nosana/kit";

import { createFlow, createState } from "../../utils/index.js";
import { createDeployment, waitForDeploymentHasNoTasks, waitForDeploymentEvent, startDeployment, waitForDeploymentStatus } from "../../common/index.js";

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

  step("wait for deployment to be in ERROR status", waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.ERROR }));

  step("deployment should not have any tasks", waitForDeploymentHasNoTasks(deployment));
})