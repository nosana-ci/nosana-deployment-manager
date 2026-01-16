import { expect } from 'vitest';
import { DeploymentStatus } from '@nosana/kit';
import type { Deployment } from '@nosana/api';
import { State } from '../../utils';

export function stopDeployment(
  state: State<Deployment>,
  callBack?: (deployment: Deployment) => void
) {
  return async () => {
    const deployment = state.get();
    await deployment.stop();
    expect(deployment.status).toBe(DeploymentStatus.STOPPING);
    callBack?.(deployment);
  };
}
