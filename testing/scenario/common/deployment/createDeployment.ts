import { expect } from 'vitest';
import type { Deployment, NosanaApi } from '@nosana/api';

import { deployer, vault } from '../../setup.js';
import { createSimpleDeploymentBody, State } from '../../utils/index.js';

export function createDeployment(
  state: State<Deployment>,
  overrides: Partial<Deployment> = {},
) {
  return async () => {
    const deploymentBody = createSimpleDeploymentBody(overrides);
    const deployment = await (deployer.api as NosanaApi).deployments.create(
      deploymentBody
    );

    expect(deployment.strategy).toBe(deploymentBody.strategy);
    expect(deployment.vault.address.toString()).toBe(vault.wallet!.address.toString());

    state.set(deployment);
  };
}