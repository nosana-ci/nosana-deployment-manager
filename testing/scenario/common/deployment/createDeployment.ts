import { expect } from 'vitest';
import type { DeploymentCreateBody, Deployment, NosanaApi } from '@nosana/api';

import { createdDeployments, deployerClient, vault } from '../../setup.js';
import { createSimpleDeploymentBody, State } from '../../utils/index.js';

export function createDeployment(
  state: State<Deployment>,
  overrides: Partial<DeploymentCreateBody> = {},
) {
  return async () => {
    const vaultAddress = vault.address.toString();
    const deploymentBody = createSimpleDeploymentBody({ ...overrides, vault: vaultAddress });
    const deployment = await (deployerClient.api as NosanaApi).deployments.create(
      deploymentBody
    );

    expect(deployment.strategy).toBe(deploymentBody.strategy);
    expect(deployment.vault.address.toString()).toBe(vaultAddress);

    createdDeployments.push(deployment);

    state.set(deployment);
  };
}