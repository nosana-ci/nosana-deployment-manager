import { Deployment, DeploymentStatus, DeploymentStrategy, JobState } from "@nosana/kit";

import { createFlow, createState } from "../../utils/index.js";
import { createDeployment, startDeployment, checkDeploymentJobs, withdrawFundsFromVault, joinMarketQueue, waitForJobState, checkDeploymentExtendTask, waitForTaskComplete, waitForDeploymentEvent, checkDeploymentStatusNot, topupVault } from "../../common/index.js";
import { topup_balance } from "../../setup.js";

// A failed EXTEND now retries instead of abandoning the deployment to ERROR.
//   npm run test:scenarios -- errors extend-error
createFlow('Extend Error', (step) => {
  const deployment = createState<Deployment>();
  const firstJob = createState<string>();

  step("create deployment with SIMPLE-EXTEND strategy", createDeployment(deployment, {
    name: `Error Scenarios > Extend Error`,
    strategy: DeploymentStrategy["SIMPLE-EXTEND"],
    timeout: 1.5
  }))

  // Self-sufficient under the `errors` aggregator: an earlier flow may have
  // drained the shared vault, so ensure there are funds to post a job.
  step("ensure vault is funded", topupVault(topup_balance));

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

  step("wait for deployment JOB_EXTEND_ERROR event", waitForDeploymentEvent(deployment, {
    type: "JOB_EXTEND_ERROR"
  }));

  // New behaviour: the failed EXTEND retries with a cooldown; the deployment is
  // NOT abandoned to terminal ERROR. (It keeps running until the job naturally
  // ends, since the extends can't land while the vault is empty.)
  step("deployment is not abandoned to ERROR", checkDeploymentStatusNot(deployment, [DeploymentStatus.ERROR]));
})
