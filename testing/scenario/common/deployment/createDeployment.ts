import { expect } from 'vitest';
import type { CreateDeployment, Deployment, NosanaApi } from '@nosana/api';

import { deployerClient, vaultClient } from '../../setup.js';
import { createSimpleDeploymentBody, State } from '../../utils/index.js';

export function createDeployment(
  state: State<Deployment>,
  overrides: Partial<CreateDeployment> = {},
) {
  return async () => {
    const deploymentBody = createSimpleDeploymentBody({ ...overrides, vault: vaultClient.wallet!.address.toString() });
    const deployment = await (deployerClient.api as NosanaApi).deployments.create(
      deploymentBody
    );

    expect(deployment.strategy).toBe(deploymentBody.strategy);
    expect(deployment.vault.address.toString()).toBe(vaultClient.wallet!.address.toString());

    state.set(deployment);
  };
}