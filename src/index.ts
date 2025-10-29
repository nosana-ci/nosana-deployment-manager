#!/usr/bin/env node

import { initSdk } from "./sdk/index.js";
import { initStats } from "./stats/index.js";
import { setConfig } from "./config/index.js";
import { startDeploymentManagerApi } from "./router/index.js";
import { DeploymentsConnection } from "./connection/deployments.js";
import { startDeploymentManagerListeners } from "./listeners/index.js";
import { createConfidentialJobDefinition } from "./definitions/confidential.jobdefinition.js";

initStats();

const sdk = initSdk();

const confidentialIpfsPin = await sdk.ipfs.pin(createConfidentialJobDefinition());

setConfig("confidential_ipfs_pin", confidentialIpfsPin);

const dbClient = await DeploymentsConnection();

if (!dbClient) {
  throw new Error("Failed to connect to the database");
}

startDeploymentManagerListeners(dbClient);
startDeploymentManagerApi(dbClient);
