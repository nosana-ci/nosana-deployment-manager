import { defineConfig } from 'vitest/config';

const defaultInclude = 'testing/scenario/scenarios/**/*.test.ts'

export default () => {
  const testNames = process.argv.slice(4)

  const include = testNames.length > 0
    ? testNames.map(name => `testing/scenario/scenarios/${name}/index.test.ts`)
    : [defaultInclude];

  return defineConfig({
    test: {
      globals: true,
      environment: 'node',
      include,
      exclude: ['node_modules', 'dist'],
      testTimeout: 1200000,
      hookTimeout: 300000,
      reporters: ['verbose'],
      bail: 1, // Stop after first test failure
      fileParallelism: false, // Run test files sequentially, not in parallel
      sequence: {
        concurrent: false, // Run tests within files sequentially
      },
      pool: 'forks', // Use forks pool for better isolation
      expect: {
        poll: {
          timeout: 60_000,
          interval: 5_000,
        },
      },
      setupFiles: ['./testing/scenario/setup.ts'],
      env: {
        NETWORK: "devnet",
        VAULT_KEY: "change_me",
        TEST_DEPLOYER_KEY_PATH: "~/.nosana/nosana_key.json",
        TEST_VAULT_KEY_PATH: "~/.nosana/nosana_key.json",
        TEST_NODE_KEY_PATH: "~/.nosana/nosana_key.json",
        TEST_MARKET: "J4HMc9haEdWUcXEpRrR31w6nrqR8oApEVSD7SYcE8Yr9",
        DOCDB_HOST: "localhost",
      },
    },
  });
}