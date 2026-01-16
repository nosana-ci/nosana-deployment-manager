import { CreateDeployment, DeploymentCreateBody, JobDefinition } from "@nosana/api";
import { DeploymentStrategy } from "@nosana/kit";

import { testRunId } from "../setup.js";

export const createSimpleDeploymentBody = (overrides?: Partial<DeploymentCreateBody>): CreateDeployment => ({
  name: `${testRunId} :: ${overrides?.name ?? 'Simple Deployment'}`,
  market: process.env.TEST_MARKET ?? 'DfJJiNU3siRQUz2a67tqoY72fUzwR8MhBEMBGK85SwAr',
  replicas: 1,
  timeout: 60,
  strategy: DeploymentStrategy.SIMPLE,
  confidential: false,
  // @ts-ignore
  job_definition: {
    version: "0.1",
    type: 'container',
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
  } as JobDefinition,
  ...overrides
});