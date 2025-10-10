#!/usr/bin/env node

import { initSdk } from "./sdk/index.js";
import { startDeploymentManagerApi } from "./router/index.js";
import { DeploymentsConnection } from "./connection/deployments.js";
import { startDeploymentManagerListeners } from "./listeners/index.js";

initSdk();

const dbClient = await DeploymentsConnection();

if (!dbClient) {
  throw new Error("Failed to connect to the database");
}

startDeploymentManagerListeners(dbClient);
startDeploymentManagerApi(dbClient);
