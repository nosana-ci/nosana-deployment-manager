import { afterAll, beforeAll } from 'vitest';
import {NosanaClient, DeploymentStatus, Vault, DeploymentsApi} from '@nosana/kit';

import { createKitClient } from './utils/createKitClient.js';
import {validateThatVaultIsUsable} from "./utils/validateThatVaultIsUsable";

export let deployerClient: NosanaClient;
export let nodeClient: NosanaClient;
export let vault : Vault;
export const min_balance = { SOL: 0.01, NOS: 0.1 };
export const topup_balance = { SOL: 0.02, NOS: 0.5 };

let providedVaultAddress = process.env.TEST_VAULT_ADDRESS;

beforeAll(async () => {
  if (!process.env.TEST_DEPLOYER_KEY_PATH || !process.env.TEST_NODE_KEY_PATH) {
    throw new Error("TEST_DEPLOYER_KEY_PATH or TEST_NODE_KEY_PATH environment variable not set.");
  }

  const { client: deployer } = await createKitClient(process.env.TEST_DEPLOYER_KEY_PATH);
  const { client: node } = await createKitClient(process.env.TEST_NODE_KEY_PATH);

  deployerClient = deployer;
  nodeClient = node;

  if (providedVaultAddress) {
    vault = await validateThatVaultIsUsable(deployerClient, providedVaultAddress);
  } else {
    vault = await (deployerClient.api.deployments as DeploymentsApi).vaults.create();
  }

  const balance = await vault.getBalance();
  if (balance.SOL < topup_balance.SOL || balance.NOS < topup_balance.NOS) {
    await vault.topup(topup_balance);
  }
}, 30000); // 30 second timeout for setup

afterAll(async () => {
  if(!providedVaultAddress) {
    console.log(`Withdrawing funds from test vault ${vault.address}`);
    await vault.withdraw();
  }

  console.log("Attempting to clean up all deployments and jobs.");
  const deployments = await deployerClient.api.deployments.list()
  for (const { status, stop } of deployments) {
    if (![DeploymentStatus.STARTING, DeploymentStatus.RUNNING].includes(status)) continue;
    await stop();
  }
});
