import { expect, vi } from 'vitest';
import { Deployment, DeploymentStatus } from '@nosana/kit';
import { components } from '@nosana/api/dist/client/schema.js';

import { apiClient, vault } from '../../setup.js';
import { createDeployment } from '../../common/index.js';
import { createFlow } from '../../utils/index.js';


/**
 * Pagination tests using the kit client
 * 
 * These tests verify the pagination behavior across all endpoints.
 */
createFlow('GET', (step) => {
  let expectedDeployment: components["schemas"]["Deployment"];

  step('setup - create deployment for GET tests', async () => {
    await createDeployment(
      {
        get: vi.fn(),
        set: (v: Deployment) => {
          expectedDeployment = {
            id: v.id,
            name: v.name,
            vault: vault.address.toString(),
            market: v.market,
            owner: v.owner,
            status: DeploymentStatus.DRAFT,
            replicas: v.replicas,
            timeout: v.timeout,
            strategy: v.strategy,
            confidential: v.confidential,
            created_at: v.created_at.toISOString(),
            updated_at: v.updated_at.toISOString(),
            endpoints: v.endpoints,
            active_jobs: v.active_jobs,
            active_revision: v.active_revision,
          }
        }
      },
      {
        name: "Endpoint Testing > GET",
      },
    )();

    expect(expectedDeployment).toBeDefined();
  });

  step('/deployments/{deployment} returns the correct deployment', async () => {
    const { data, response } = await apiClient.GET('/api/deployments/{deployment}', { params: { path: { deployment: expectedDeployment.id } } });

    if (!data) {
      throw new Error(`Expected data in response, got none. Response: ${JSON.stringify(response)}`);
    }

    expect(response.status).toBe(200);
    expect(data).toEqual(expect.objectContaining(expectedDeployment));
  });

  step('/deployments/list return list with pagination params', async () => {
    const { data, response } = await apiClient.GET('/api/deployments');

    expect(response.status).toBe(200);
    expect(data).toHaveProperty('deployments');
    expect(data).toHaveProperty('pagination');
    expect(Array.isArray(data.deployments)).toBe(true);
    expect(data.deployments.length).toBeGreaterThanOrEqual(1);
    expect(data.deployments).toContainEqual(expect.objectContaining(expectedDeployment));
    expect(data.pagination).toHaveProperty('cursor_next');
    expect(data.pagination).toHaveProperty('cursor_prev');
    expect(data.pagination.total_items).toBeGreaterThanOrEqual(1);
  });

  step('/deployments/{deployment}/events returns paginated events', async () => {
    const { data, response } = await apiClient.GET('/api/deployments/{deployment}/events', {
      params: { path: { deployment: expectedDeployment.id } }
    });

    expect(response.status).toBe(200);
    expect(data).toHaveProperty('events');
    expect(data).toHaveProperty('pagination');
    expect(Array.isArray(data.events)).toBe(true);
    expect(data.events.length).toBeGreaterThanOrEqual(0);
    expect(data.pagination.total_items).toBeGreaterThanOrEqual(0);
  });

  step('/deployments/{deployment}/revisions returns paginated revisions', async () => {
    const { data, response } = await apiClient.GET('/api/deployments/{deployment}/revisions', {
      params: { path: { deployment: expectedDeployment.id } }
    });

    expect(response.status).toBe(200);
    expect(data).toHaveProperty('revisions');
    expect(data).toHaveProperty('pagination');
    expect(Array.isArray(data.revisions)).toBe(true);
    expect(data.revisions.length).toBe(1);
    expect(data.pagination.total_items).toBe(1);
  });

  step('/deployments/{deployment}/jobs returns paginated jobs', async () => {
    const { data, response } = await apiClient.GET('/api/deployments/{deployment}/jobs', {
      params: { path: { deployment: expectedDeployment.id } }
    });

    expect(response.status).toBe(200);
    expect(data).toHaveProperty('jobs');
    expect(data).toHaveProperty('pagination');
    expect(Array.isArray(data.jobs)).toBe(true);
    expect(data.jobs.length).toBeGreaterThanOrEqual(0);
    expect(data.pagination.total_items).toBeGreaterThanOrEqual(0);
  });

  step('/deployments/{deployment}/tasks returns paginated tasks', async () => {
    const { data, response } = await apiClient.GET('/api/deployments/{deployment}/tasks', {
      params: { path: { deployment: expectedDeployment.id } }
    });

    expect(response.status).toBe(200);
    expect(data).toHaveProperty('tasks');
    expect(data).toHaveProperty('pagination');
    expect(Array.isArray(data.tasks)).toBe(true);
    expect(data.tasks.length).toBeGreaterThanOrEqual(0);
    expect(data.pagination.total_items).toBeGreaterThanOrEqual(0);
  });

  step('cleanup - stop deployment', async () => {
    const { data } = await apiClient.GET('/api/deployments/{deployment}', { params: { path: { deployment: expectedDeployment.id } } });
    if (data?.status !== 'STOPPED' && data?.status !== 'DRAFT') {
      await apiClient.POST('/api/deployments/{deployment}/stop', { params: { path: { deployment: expectedDeployment.id } } });
    }
  });
});
