import { Deployment, DeploymentStatus } from "@nosana/kit";

import { createFlow, createState } from "../../utils/index.js";
import { createDeployment, startDeployment, waitForDeploymentStatus, checkDeploymentJobs, withdrawFundsFromVault, stopDeployment, waitForDeploymentEvent, waitForDeploymentHasNoTasks } from "../../common/index.js";

createFlow('Stop Error', (step) => {
  const deployment = createState<Deployment>();

  step("create deployment", createDeployment(deployment, {
    name: `Error Scenarios > Stop Error`,
  }))

  step("start deployment", startDeployment(deployment));

  step('wait for first job to be posted', checkDeploymentJobs(
    deployment,
    { expectedJobsCount: 1 }
  ));

  step("withdraw funds from vault", withdrawFundsFromVault())

  step("stop deployment", stopDeployment(deployment));

  step("wait for deployment JOB_LIST_ERROR event", waitForDeploymentEvent(deployment, {
    type: "JOB_STOP_ERROR"
  }));

  step("wait for deployment to be in ERROR status", waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.ERROR }));

  step("deployment should not have any tasks", waitForDeploymentHasNoTasks(deployment));
})