import { Deployment, DeploymentStatus } from "@nosana/kit";

import { createFlow, createState } from "../../utils/index.js";
import { createDeployment, startDeployment, waitForDeploymentStatus, checkDeploymentJobs, withdrawFundsFromVault, stopDeployment, waitForDeploymentEvent, waitForDeploymentHasTask, checkDeploymentStatusNot, topupVault } from "../../common/index.js";
import { TaskType } from "../../../../src/types/index.js";
import { topup_balance } from "../../setup.js";

// A stop that errors (here: empty vault, so the stop tx can't pay fees) no longer
// strands the deployment in ERROR forever — the STOP retries while STOPPING and
// auto-recovers to STOPPED once the vault is funded again.
//   npm run test:scenarios -- errors stop-error
createFlow('Stop Error', (step) => {
  const deployment = createState<Deployment>();

  step("create deployment", createDeployment(deployment, {
    name: `Error Scenarios > Stop Error`,
  }))

  // Self-sufficient under the `errors` aggregator: an earlier flow may have
  // drained the shared vault, so ensure there are funds to post a job.
  step("ensure vault is funded", topupVault(topup_balance));

  step("start deployment", startDeployment(deployment));

  step('wait for first job to be posted', checkDeploymentJobs(
    deployment,
    { expectedJobsCount: 1 }
  ));

  step("withdraw funds from vault", withdrawFundsFromVault())

  step("stop deployment", stopDeployment(deployment));

  step("wait for deployment JOB_STOP_ERROR event", waitForDeploymentEvent(deployment, {
    type: "JOB_STOP_ERROR"
  }));

  // New behaviour: the failed STOP is not abandoned to ERROR — it keeps retrying
  // toward STOPPED.
  step("deployment is not abandoned to ERROR", checkDeploymentStatusNot(deployment, [DeploymentStatus.ERROR]));

  step("a STOP retry stays scheduled", waitForDeploymentHasTask(deployment, { task: TaskType.STOP }));

  // Fund the vault again; the pending STOP retry now succeeds on its own — no
  // manual restart needed.
  step("topup vault", topupVault())

  step("deployment auto-recovers to STOPPED", waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.STOPPED }));
})
