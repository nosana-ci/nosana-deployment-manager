import { address, Deployment, DeploymentStatus, DeploymentStrategy, JobState } from "@nosana/kit";

import { createFlow, createState } from "../../utils/index.js";
import { createDeployment, startDeployment, waitForDeploymentStatus, checkDeploymentJobs, withdrawFundsFromVault, joinMarketQueue, waitForJobState, checkDeploymentExtendTask, waitForTaskComplete, waitForDeploymentEvent, waitForDeploymentHasNoTasks } from "../../common/index.js";
import { deployerClient } from "../../setup.js";
import { expect } from "vitest";

createFlow('Extend Error', (step) => {
  const deployment = createState<Deployment>();
  const firstJob = createState<string>();

  step("create deployment with SIMPLE-EXTEND strategy", createDeployment(deployment, {
    name: `Error Scenarios > Stop Error`,
    strategy: DeploymentStrategy["SIMPLE-EXTEND"],
    timeout: 1.5
  }))

  step('join market queue before starting deployment', joinMarketQueue(() => deployment.get().market));

  step("start deployment", startDeployment(deployment));

  step('wait for first job to be posted', checkDeploymentJobs(
    deployment,
    { expectedJobsCount: 1 },
    ({ jobs }) => firstJob.set(jobs[0].job)
  ));

  step('wait for first job to be running', waitForJobState(firstJob, { expectedState: JobState.RUNNING }));

  step("withdraw funds from vault", withdrawFundsFromVault())

  step('wait for extend task to be scheduled', checkDeploymentExtendTask(deployment, { job: firstJob }));

  step('wait for extend task to execute (<= 2 minutes)', waitForTaskComplete(deployment));

  step("wait for deployment JOB_LIST_ERROR event", waitForDeploymentEvent(deployment, {
    type: "JOB_EXTEND_ERROR"
  }));

  step("wait for deployment to be in ERROR status", waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.ERROR }));

  step("deployment should not have any tasks", waitForDeploymentHasNoTasks(deployment));
})