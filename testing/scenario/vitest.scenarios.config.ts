import { defineConfig } from 'vitest/config';

const defaultInclude = 'testing/scenario/scenarios/*.test.ts'

export default () => {
  const scenario = process.argv[5]
  const flow = process.argv[6];

  console.log(`Running scenario tests${scenario ? ` for scenario: ${scenario}` : ''}${flow ? ` and flow: ${flow}` : ''}`);

  const include = scenario && scenario.length > 0
    ? [flow ? `testing/scenario/scenarios/${scenario}/${flow}.test.ts` : `testing/scenario/scenarios/${scenario}.test.ts`]
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
      bail: 0, // Continue to run tests even if some fail
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
        NETWORK: process.env.NETWORK ?? "devnet",
        BACKEND_URL: process.env.BACKEND_URL ?? "http://localhost:3001",
        TEST_VAULT_ADDRESS: process.env.TEST_VAULT_ADDRESS,
        TEST_DEPLOYER_KEY_PATH: process.env.TEST_DEPLOYER_KEY_PATH ?? "~/.nosana/nosana_key.json",
        TEST_NODE_KEY_PATH: process.env.TEST_NODE_KEY_PATH ?? "~/.nosana/nosana_key.json",
        TEST_MARKET: process.env.TEST_MARKET ?? "9MGKqixvtLJgL46Bp38ZrD3MxTMRt57VL3rQtQY64zj4",
      },
    },
  });
}