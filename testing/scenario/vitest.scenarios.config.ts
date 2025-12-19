import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['testing/scenario/scenarios/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 1200000,
    hookTimeout: 300000,
    reporters: ['verbose'],
    bail: 1, // Stop after first test failure
    sequence: {
      concurrent: false, // Run tests sequentially, not in parallel
    },
    expect: {
      poll: {
        timeout: 60_000,
        interval: 5_000,
      },
    },
    setupFiles: ['./testing/scenario/setup.ts'],
  },
});