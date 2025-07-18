import { Db } from "mongodb";

import { startDeploymentListener } from "./deployments/index.js";
import { startTaskListener } from "../tasks/index.js";

export function startDeploymentManagerListeners(db: Db) {
  startDeploymentListener(db);
  startTaskListener(db);
}
