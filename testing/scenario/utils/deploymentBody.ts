import { CreateDeployment } from "@nosana/api";
import { DeploymentStrategy } from "@nosana/kit";

export const createSimpleDeploymentBody = (overrides?: Partial<CreateDeployment>) => ({
  name: 'Simple deployment test',
  market: 'DfJJiNU3siRQUz2a67tqoY72fUzwR8MhBEMBGK85SwAr',
  replicas: 1,
  timeout: 60,
  strategy: DeploymentStrategy.SIMPLE,
  confidential: false,
  job_definition: {
    version: '0.1' as const,
    type: 'container' as const,
    ops: [
      {
        type: 'container/run' as const,
        id: 'nginx',
        args: {
          cmd: [],
          image: 'nginx',
          expose: 80,
        },
      },
    ],
  },
  ...overrides
});