import fs from 'fs';
import os from 'os';
import { afterAll, beforeAll, expect } from 'vitest';
import { createTestClient } from './utils/createKitClient.js';
import { NosanaClient, DeploymentStatus } from '@nosana/kit';

export let deployer: NosanaClient;
export let vault: NosanaClient;
export let min_balance = { SOL: 0.01, NOS: 0.1 };

beforeAll(async () => {
  const deployerKey = JSON.parse(
    fs.readFileSync(os.homedir() + '/.nosana/nosana_key.json', 'utf8')
  );
  const vaultKey = JSON.parse(
    fs.readFileSync(os.homedir() + '/.nosana/nosana_vault_key.json', 'utf8')
  );

  if (!deployerKey || !vaultKey) {
    throw new Error("Deployer or vault key file not found.");
  }

  deployer = await createTestClient('/.nosana/nosana_key.json');
  vault = await createTestClient('/.nosana/nosana_vault_key.json');
}, 30000); // 30 second timeout for setup

afterAll(async () => {
  console.log("Attempted to clean up all deployments and jobs.");
  const deployments = await deployer.api.deployments.list()
  for (const { status, stop } of deployments) {
    if (![DeploymentStatus.STARTING, DeploymentStatus.RUNNING].includes(status)) continue;

    await stop();
  }
});
