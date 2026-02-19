import { expect } from 'vitest';

import { deployerClient } from '../../setup.js';

export function checkDeploymentsPagination(minExpectedCount: number) {
  return async () => {
    const response = await deployerClient.api.deployments.list();
    expect(response.deployments.length).toBeGreaterThanOrEqual(minExpectedCount);
    expect(response.pagination.total_items).toBe(response.deployments.length);
  };
}
