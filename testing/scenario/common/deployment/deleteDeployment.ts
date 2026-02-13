import { expect } from 'vitest';
import { Deployment } from '@nosana/api';
import type { State } from '../../utils';
import { createdDeployments } from '../../setup.js';

export function deleteDeployment(
  state: State<Deployment>,
  callBack?: () => void
) {
  return async () => {
    const deployment = state.get();
    
    // Use the kit's delete method
    await deployment.delete();
    
    // Remove from createdDeployments map
    createdDeployments.delete(deployment.id);
    
    callBack?.();
  };
}
