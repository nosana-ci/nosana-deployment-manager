import { DeploymentStrategy } from "@nosana/kit";

import type { DeploymentDocument } from "../../types/index.js";

export function isSimpleOrSimpleExtendedDeployment(deployment: DeploymentDocument): boolean {
  return deployment.strategy === DeploymentStrategy["SIMPLE"] || deployment.strategy === DeploymentStrategy["SIMPLE-EXTEND"];
}