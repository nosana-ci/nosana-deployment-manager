import { expect } from 'vitest';
import { DeploymentStatus } from '@nosana/kit';
import type { Deployment, NosanaApi } from '@nosana/api';

import { deployerClient } from '../../setup.js';
import { State } from '../../utils/index.js';

export function waitForDeploymentStatus(
  state: State<Deployment>,
  { expectedStatus }: { expectedStatus: DeploymentStatus },
  callBack?: (deployment: Deployment) => void
) {
  return async () => {
    await expect.poll(
      async () => {
        state.set(await (deployerClient.api as NosanaApi).deployments.get(state.get().id));
        return state.get().status;
      },
      { message: `Waiting for deployment to reach ${expectedStatus} status` }
    ).toBe(expectedStatus);

    callBack?.(state.get());
  };
}
