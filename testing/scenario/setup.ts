import fs from 'fs';
import os from 'os';
import { afterAll, beforeAll } from 'vitest';
import { createTestClient } from './utils/createKitClient.js';
import { NosanaClient, DeploymentStatus } from '@nosana/kit';
import path from "path";
import {generateKeyPair} from "../../src/vault/generate.js";
import {getAddressFromPublicKey} from "@solana/addresses";
import {
  createVaultDocument,
} from "../../src/router/routes/post/vaults/createSharedVault/createSharedVaultFactory.js";
import {VaultCollection} from "../../src/types/index.js";
import {encryptWithKey} from "../../src/vault/index.js";
import bs58 from "bs58";
import { createKeyPairFromPrivateKeyBytes } from '@solana/kit';
import {createTestDbClient} from "./utils/createDbClient.js";
import {Collection, type Db} from "mongodb";

export let deployerClient: NosanaClient;
export let vaultClient: NosanaClient;
export let vaultAddress: string;
export let min_balance = {SOL: 0.01, NOS: 0.1};
let dbClient: Db;
let vaultsCollection: Collection<VaultCollection>;

beforeAll(async () => {
  const {deployerKeyPath, deployerAddress} = await loadDeployerKey();
  const {vaultKeyPath, bs58PublicKey, encryptedPrivateKey} = await generateVault();
  await storeVaultInDb(bs58PublicKey, encryptedPrivateKey, deployerAddress);

  deployerClient = await createTestClient(deployerKeyPath);
  vaultClient = await createTestClient(vaultKeyPath);

  console.log("Deployer address:", deployerAddress);
  const nosBalance = await deployerClient.nos.getBalance();
  console.log(`Deployer NOS balance: ${nosBalance} NOS`);
}, 30000); // 30 second timeout for setup

afterAll(async () => {
  console.log("Cleaning up all vaults, deployments and jobs.");
  await removeAllVaultsFromDb();

  const deployments = await deployerClient.api.deployments.list()
  for (const { status, stop } of deployments) {
    if (![DeploymentStatus.STARTING, DeploymentStatus.RUNNING].includes(status)) continue;

    await stop();
  }
});

async function loadDeployerKey() {
  const deployerKeyPath = os.homedir() + '/.nosana/nosana_key.json';
  const deployerKey = JSON.parse(
    fs.readFileSync(deployerKeyPath, 'utf8')
  );

  if (!deployerKey) {
    throw new Error("Deployer key not valid.");
  }

  const deployerKeyPair = await createKeyPairFromPrivateKeyBytes(new Uint8Array(deployerKey).slice(0, 32));
  const deployerAddress = await getAddressFromPublicKey(deployerKeyPair.publicKey);

  return {deployerKeyPath, deployerAddress};
}

async function generateVault() {
  const tmpDir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'scenario-testing-'));
  const {publicKey, extractedPublicKey, extractedPrivateKey} = await generateKeyPair();
  vaultAddress = await getAddressFromPublicKey(publicKey);
  console.log("Vault address:", vaultAddress);
  const vaultKey = new Uint8Array(extractedPrivateKey, extractedPrivateKey.byteLength - 32, 32);
  const vaultKeyPath = tmpDir + '/vault_key.json';
  fs.writeFileSync(vaultKeyPath, JSON.stringify(Array.from(vaultKey)));
  console.log("Vault file created:", vaultKeyPath);
  const bs58PublicKey = bs58.encode(new Uint8Array(extractedPublicKey));
  const encryptedPrivateKey = encryptWithKey(
    new Uint8Array(extractedPrivateKey).slice(-32).toString()
  );

  if (!vaultKey) {
    throw new Error("Generated vault key not valid.");
  }

  return {vaultKeyPath, bs58PublicKey, encryptedPrivateKey};
}

async function storeVaultInDb(bs58PublicKey: string, encryptedPrivateKey: string, deployerAddress: NominalType<"brand", "Address"> & NominalType<"stringEncoding", "base58"> & string) {
  console.log("Creating DB client");
  dbClient = await createTestDbClient();
  vaultsCollection = dbClient.collection<VaultCollection>("vaults");
  const vaultObj = createVaultDocument(bs58PublicKey, encryptedPrivateKey, deployerAddress, new Date());

  console.log("Upserting vault document into DB for vault:", vaultObj.vault);
  const result = await vaultsCollection.updateOne(
    {vault: vaultObj.vault},
    {$setOnInsert: vaultObj},
    {upsert: true}
  );

  const acknowledged = result.acknowledged && (result.upsertedCount > 0 || result.matchedCount > 0);
  console.log("Vault upsert acknowledged:", acknowledged);
}

async function removeAllVaultsFromDb() {
  // TODO: Remove only what was created during the test
  await vaultsCollection.deleteMany({}).then(() => {
    console.log("Vaults collection cleared.");
  }).catch((err) => {
    console.error("Error clearing vaults collection:", err);
  });
}
