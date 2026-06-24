import { afterAll, beforeAll } from 'vitest';
import { NosanaClient, DeploymentStatus, Vault, DeploymentsApi } from '@nosana/kit';
import { getScenarioClient, createMarket } from '@nosana/scenario';

import { createKitClient } from './utils/createKitClient.js';
import { validateThatVaultIsUsable } from "./utils/validateThatVaultIsUsable";
import { Deployment } from "@nosana/api";
import { eatMarketQueue } from './utils/eatMarketQueue.js';
import { ensureStakeAccount } from './utils/ensureStakeAccount.js';
import { QueryClient } from '@nosana/api/dist/client/index.js';
import { createApiClient } from './utils/createApiClient.js';

export let deployerClient: NosanaClient;
export let nodeClient: NosanaClient;
export let vault: Vault;
export let apiClient: QueryClient;
export const min_balance = { SOL: 0.01, NOS: 0.1 };
export const topup_balance = { SOL: 0.02, NOS: 0.5 };
export const createdDeployments: Map<string, Deployment> = new Map();
export const testRunId = new Date().toISOString();
export const providedVaultAddress = process.env.TEST_VAULT_ADDRESS;

// `localnet` (default) runs against a local validator with Nosana programs
// pre-baked (@nosana/localnet): no RPC throttling, no indexer lag, matched
// program versions. `devnet`/`mainnet` use a funded keypair from a file.
const network = process.env.NOSANA_NETWORK ?? 'localnet';

beforeAll(async () => {
  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) {
    throw new Error("BACKEND_URL environment variable not set.");
  }

  if (network === 'localnet') {
    // One funded wallet (airdropped SOL + minted NOS) acts as both deployer and
    // node — matching the single-key devnet harness. Deployment CRUD is routed to
    // the local DM via BACKEND_URL; chain ops hit the local validator.
    deployerClient = await getScenarioClient({
      network: 'localnet',
      key: 'deployer',
      airdropAmount: 100_000_000_000n,
      mintAmount: 1_000_000_000_000n,
      config: { api: { backend_url: backendUrl } },
    });
    nodeClient = deployerClient;
    // A node needs a stake account to join a market queue.
    await ensureStakeAccount(deployerClient);
    // Fresh, dedicated market per test file; route deployments to it (replaces
    // the shared devnet TEST_MARKET — no queue contention, no EAT needed).
    const market = await createMarket(undefined, deployerClient);
    process.env.TEST_MARKET = market.toString();
  } else {
    const testDeployerKeyPath = process.env.TEST_DEPLOYER_KEY_PATH;
    const testNodeKeyPath = process.env.TEST_NODE_KEY_PATH;
    if (!testDeployerKeyPath || !testNodeKeyPath) {
      throw new Error("TEST_DEPLOYER_KEY_PATH or TEST_NODE_KEY_PATH environment variable not set.");
    }
    const { client: deployer } = await createKitClient(backendUrl, testDeployerKeyPath);
    const { client: node } = await createKitClient(backendUrl, testNodeKeyPath);
    deployerClient = deployer;
    nodeClient = node;
  }

  apiClient = createApiClient(deployerClient);

  if (process.env.EAT === 'true') {
    await eatMarketQueue(process.env.TEST_MARKET!, nodeClient)
  }

  if (providedVaultAddress && providedVaultAddress !== "undefined") {
    vault = await validateThatVaultIsUsable(deployerClient, providedVaultAddress);
  } else {
    vault = await (deployerClient.api.deployments as DeploymentsApi).vaults.create();
    const balance = await vault.getBalance();
    if (balance.SOL < topup_balance.SOL || balance.NOS < topup_balance.NOS) {
      await vault.topup(topup_balance);
    }
  }
}, 120000); // generous: localnet airdrop + NOS mint + market creation + vault topup

afterAll(async () => {
  if (!providedVaultAddress || providedVaultAddress === "undefined") {
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
  for (const [id, deployment] of createdDeployments) {
    try {
      const { status } = await deployerClient.api.deployments.get(id);
      if ([DeploymentStatus.STOPPED, DeploymentStatus.STOPPING, DeploymentStatus.STARTING].includes(status)) {
        console.log("Not stopping deployment:", id, status);
        // TODO: how to stop jobs that are in STARTING?
        //       for those stop() returns "deployment is in incorrect state"
      } else {
        console.log("Stopping deployment:", id, status);
        await deployment.stop();
      }
    } catch (error) {
      console.error("Error checking deployment status:", id, (error as Error).message);
      throw error;
    }
  }
});
