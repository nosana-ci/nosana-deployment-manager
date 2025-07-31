#!/usr/bin/env node

import { startDeploymentManagerApi } from "./router/index.js";
import { DeploymentsConnection } from "./connection/deployments.js";
import { startDeploymentManagerListeners } from "./listeners/index.js";

const dbClient = await DeploymentsConnection();

if (!dbClient) {
  throw new Error("Failed to connect to the database");
}

startDeploymentManagerListeners(dbClient);
startDeploymentManagerApi(dbClient);
