import { createNosanaClient } from '@nosana/kit';
import { createKeyPairSignerFromPrivateKeyBytes } from '@solana/signers';
import fs from 'fs';
import os from 'os';
import { createTestClient } from './utils/createKitClient';

const scenarioArg = process.argv[2];

if (!scenarioArg) {
  console.error("Please provide a scenario name as an argument.");
  process.exit(1);
}

const deployerKey = JSON.parse(
  fs.readFileSync(os.homedir() + '/.nosana/nosana_key.json', 'utf8')
);
const vaultKey = JSON.parse(
  fs.readFileSync(os.homedir() + '/.nosana/nosana_vault_key.json', 'utf8')
);

if (!deployerKey || !vaultKey) {
  console.error("Deployer or vault key file not found.");
  process.exit(1);
}

export async function runScenario() {
  try {
    const scenario = await import(`./scenarios/${scenarioArg}.ts`);
    console.log(`Running scenario: ${scenarioArg}.ts`);
    await scenario.default(
      await createTestClient('/.nosana/nosana_key.json'),
      await createTestClient('/.nosana/nosana_vault_key.json')
    );
  } catch (error) {
    console.error("Error running scenario:", error);
    process.exit(1);
  }
}

runScenario();