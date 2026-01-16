import { type DeploymentDocument, DeploymentStatus, DeploymentStrategy } from "../../../types/index.js";

export function isActiveInfiniteDeployment(deployment: DeploymentDocument): boolean {
  return !!(deployment.status === DeploymentStatus.RUNNING && deployment.strategy === DeploymentStrategy.INFINITE);
}