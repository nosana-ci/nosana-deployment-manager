export * from "./deployment/createDeployment.js";
export * from "./deployment/checkDeploymentJobs.js";
export * from "./deployment/checkAllJobsStopped.js";
export * from "./deployment/checkDeploymentExtendTask.js"
export * from "./deployment/checkNoDeploymentExtendTask.js";
export * from "./deployment/startDeployment.js";
export * from "./deployment/stopDeployment.js";
export * from "./deployment/waitForTaskComplete.js";
export * from "./deployment/waitForDeploymentStatus.js";

// Job actions
export * from "./jobs/checkJobsTimeout.js";
export * from "./jobs/joinMarketQueue.js";
export * from "./jobs/waitForJobState.js";

// Node actions
export * from "./node/finishJob.js";
export * from "./node/verifyJobAssignedToNode.js";

// Vault actions
export * from "./vault/checkSufficientVaultBalance.js";

export function waitForSeconds(seconds: number) {
  return async () => {
    await new Promise(resolve => setTimeout(resolve, seconds * 1000));
  };
}