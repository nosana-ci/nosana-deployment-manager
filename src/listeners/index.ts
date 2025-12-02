import { Db } from "mongodb";

import { startDeploymentCollectionListener } from "./deployments/index.js";
import { startTaskCollectionListener } from "../tasks/index.js";
import { startJobAccountsListeners } from "./accounts/index.js";
import { startJobsCollectionListener } from "./jobs/index.js";

export function startDeploymentManagerListeners(db: Db) {
  startDeploymentCollectionListener(db);
  startTaskCollectionListener(db);
  startJobsCollectionListener(db);
  startJobAccountsListeners(db);
}
