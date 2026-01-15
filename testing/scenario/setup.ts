import { afterAll, beforeAll } from 'vitest';
import { NosanaClient, DeploymentStatus } from '@nosana/kit';

import { createKitClient } from './utils/createKitClient.js';

export let deployerClient: NosanaClient;
export let vaultClient: NosanaClient;
export let nodeClient: NosanaClient;

export const min_balance = { SOL: 0.01, NOS: 0.1 };

beforeAll(async () => {
  if (!process.env.TEST_DEPLOYER_KEY_PATH || !process.env.TEST_VAULT_KEY_PATH || !process.env.TEST_NODE_KEY_PATH) {
    throw new Error("TEST_DEPLOYER_KEY_PATH, TEST_VAULT_KEY_PATH or TEST_NODE_KEY_PATH environment variable not set.");
  }

  const { client: deployer } = await createKitClient(process.env.TEST_DEPLOYER_KEY_PATH);
  const { client: vault } = await createKitClient(process.env.TEST_VAULT_KEY_PATH);
  const { client: node } = await createKitClient(process.env.TEST_NODE_KEY_PATH);

  deployerClient = deployer;
  vaultClient = vault;
  nodeClient = node;
}, 30000); // 30 second timeout for setup

afterAll(async () => {
  console.log("Attempting to clean up all deployments and jobs.");
  const deployments = await deployerClient.api.deployments.list()
  for (const { status, stop } of deployments) {
    if (![DeploymentStatus.STARTING, DeploymentStatus.RUNNING].includes(status)) continue;

    await stop();
  }
});
