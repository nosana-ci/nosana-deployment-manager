import { DeploymentStatus } from "../../types/index.js";

/** Map a task error message to the deployment status it should trigger. */
export function deploymentStatusFromError(error: string): DeploymentStatus {
  return error.includes("InsufficientFundsForRent")
    ? DeploymentStatus.INSUFFICIENT_FUNDS
    : DeploymentStatus.ERROR;
}
