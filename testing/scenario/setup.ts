import {afterAll, beforeAll} from 'vitest';
import {NosanaClient, DeploymentStatus, Vault, DeploymentsApi} from '@nosana/kit';

import {createKitClient} from './utils/createKitClient.js';
import {validateThatVaultIsUsable} from "./utils/validateThatVaultIsUsable";
import {Deployment} from "@nosana/api";

export let deployerClient: NosanaClient;
export let nodeClient: NosanaClient;
export let vault: Vault;
export const min_balance = {SOL: 0.01, NOS: 0.1};
export const topup_balance = {SOL: 0.02, NOS: 0.5};
export const createdDeployments: Deployment[] = [];
export const testRunId = new Date().toISOString();
export const providedVaultAddress = process.env.TEST_VAULT_ADDRESS;

beforeAll(async () => {
  const backendUrl = process.env.BACKEND_URL;
  const testDeployerKeyPath = process.env.TEST_DEPLOYER_KEY_PATH;
  const testNodeKeyPath = process.env.TEST_NODE_KEY_PATH;
  if (!backendUrl || !testDeployerKeyPath || !testNodeKeyPath) {
    throw new Error("BACKEND_URL, TEST_DEPLOYER_KEY_PATH or TEST_NODE_KEY_PATH environment variable not set.");
  }

  const {client: deployer} = await createKitClient(backendUrl, testDeployerKeyPath);
  const {client: node} = await createKitClient(backendUrl, testNodeKeyPath);

  deployerClient = deployer;
  nodeClient = node;

  if (providedVaultAddress) {
    vault = await validateThatVaultIsUsable(deployerClient, providedVaultAddress);
  } else {
    vault = await (deployerClient.api.deployments as DeploymentsApi).vaults.create();
    const balance = await vault.getBalance();
    if (balance.SOL < topup_balance.SOL || balance.NOS < topup_balance.NOS) {
      await vault.topup(topup_balance);
    }
  }
}, 30000); // 30 second timeout for setup

afterAll(async () => {
  if (!providedVaultAddress) {
    console.log("Withdrawing funds from test vault:", vault.address);
    try {
      await vault.withdraw();
    } catch (e) {
      const error = e as Error;
      if (error.message.includes("Vault has no funds to withdraw")) {
        console.log("Vault already empty");
      } else
        throw error;
    }
  }

  console.log("Stopping all created deployments");
  for (const deployment of createdDeployments) {
    const {status} = await deployerClient.api.deployments.get(deployment.id);
    if ([DeploymentStatus.STOPPED, DeploymentStatus.STOPPING, DeploymentStatus.STARTING].includes(status)) {
      console.log("Not stopping deployment:", deployment.id, status);
      // TODO: how to stop jobs that are in STARTING?
      //       for those stop() returns "deployment is in incorrect state"
    } else {
      console.log("Stopping deployment:", deployment.id, status);
      await deployment.stop()
    }
  }
});
