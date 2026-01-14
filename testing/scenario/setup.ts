import { afterAll, beforeAll } from 'vitest';
import { NosanaClient, DeploymentStatus } from '@nosana/kit';

import { createKitClient } from './utils/createKitClient.js';
import { NosanaCollections } from '../../src/definitions/collection.js';
import { createDeploymentsConnection } from '../../src/connection/deployments.js';
import { storeVaultDocument } from '../../src/router/routes/post/vaults/createSharedVault/createSharedVaultFactory.js';

import type { VaultDocument } from '../../src/types/index.js';

export let deployerClient: NosanaClient;
export let vaultClient: NosanaClient;
export let nodeClient: NosanaClient;

export const min_balance = { SOL: 0.01, NOS: 0.1 };

let vaultUpserted = false;

beforeAll(async () => {
  if (!process.env.TEST_DEPLOYER_KEY_PATH || !process.env.TEST_VAULT_KEY_PATH || !process.env.TEST_NODE_KEY_PATH) {
    throw new Error("TEST_DEPLOYER_KEY_PATH, TEST_VAULT_KEY_PATH or TEST_NODE_KEY_PATH environment variable not set.");
  }

  const { client: deployer } = await createKitClient(process.env.TEST_DEPLOYER_KEY_PATH);
  const { client: vault, encryptedPrivateKey } = await createKitClient(process.env.TEST_VAULT_KEY_PATH);
  const { client: node } = await createKitClient(process.env.TEST_NODE_KEY_PATH);

  deployerClient = deployer;
  vaultClient = vault;
  nodeClient = node;

  const db = await createDeploymentsConnection();
  const { upserted } = await storeVaultDocument(
    db.collection<VaultDocument>(NosanaCollections.VAULTS),
    vault.wallet?.address.toString()!,
    encryptedPrivateKey,
    deployer.wallet?.address.toString()!
  );
  vaultUpserted = upserted;
}, 30000); // 30 second timeout for setup

afterAll(async () => {
  console.log("Attempting to clean up all deployments and jobs.");
  const deployments = await deployerClient.api.deployments.list()
  for (const { status, stop } of deployments) {
    if (![DeploymentStatus.STARTING, DeploymentStatus.RUNNING].includes(status)) continue;

    await stop();
  }

  if (vaultUpserted) {
    // const db = await createDeploymentsConnection();
    // const vaults = db.collection<VaultDocument>(NosanaCollections.VAULTS);
    // Maybe withdraw but less imported as we have the vault key anyway
    // const result = await vaults.deleteOne({ vault: vault.wallet?.address.toString()! });
    // console.log(`Deleted vault document for ${vault.wallet?.address.toString()}:`, result);
  }
});
