import { Db } from "mongodb";

import { startDeploymentListener } from "./deployments/index.js";
import { startTaskListener } from "../tasks/index.js";
import { startJobListeners } from "./jobs/index.js";

export function startDeploymentManagerListeners(db: Db) {
  startDeploymentListener(db);
  startTaskListener(db);
  startJobListeners(db)
}
