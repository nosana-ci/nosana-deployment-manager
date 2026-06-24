import { execSync } from 'child_process';
import { expect, describe, it } from 'vitest';

import { createFlow } from '../utils/createFlow.js';

// This flow drives a single combined `deployment_manager` service running in
// `mode: all` (it `docker compose up`s that service and SIGTERMs PID 1). The
// local compose splits the DM into `deployment_manager_api` + `_worker`, so the
// flow only applies against a combined deployment. Skip unless opted in.
const flow: typeof createFlow = process.env.RUN_SHUTDOWN_TEST === 'true'
  ? createFlow
  : (name) =>
      describe.skip(
        `${name} (needs a combined mode:all deployment_manager; set RUN_SHUTDOWN_TEST=true)`,
        () => {
          it('skipped', () => {});
        }
      );

const COMPOSE_DIR = `${process.cwd()}`;
const SERVICE = 'deployment_manager';
const BASE_URL = process.env.DEPLOYMENT_MANAGER_URL ?? 'http://localhost:3001';

function dc(cmd: string): string {
  return execSync(`docker compose ${cmd}`, {
    cwd: COMPOSE_DIR,
    encoding: 'utf-8',
    timeout: 120_000,
  }).trim();
}

async function pollHealthy(maxAttempts = 30, intervalMs = 2000): Promise<void> {
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) {
        const body = (await res.json()) as { status?: string };
        if (body.status === 'healthy') return;
      }
    } catch {
      // container still starting
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`deployment_manager did not become healthy at ${BASE_URL}/health`);
}

flow('Graceful shutdown', (step) => {
  step('deployment_manager is healthy before shutdown', async () => {
    dc(`up -d ${SERVICE}`);
    await pollHealthy();

    const response = await fetch(`${BASE_URL}/health`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('status', 'healthy');
    expect(body).toHaveProperty('mode', 'all');
  });

  step('SIGTERM triggers an ordered shutdown sequence', async () => {
    dc(`exec -T ${SERVICE} kill -TERM 1`);

    // Worker drain budget is 120 s; with no in-flight tasks the handler
    // finishes well before that.
    await new Promise((resolve) => setTimeout(resolve, 10_000));

    const logs = dc(`logs ${SERVICE} --tail=80`);
    expect(logs).toContain('shutting down gracefully');
    expect(logs).toContain('stopped task scheduling');
    expect(logs).toContain('closed change streams');
    expect(logs).toContain('shutdown complete');
  });

  step('deployment_manager restarts cleanly after shutdown', async () => {
    dc(`up -d ${SERVICE}`);
    await pollHealthy();

    const response = await fetch(`${BASE_URL}/health`);
    expect(response.status).toBe(200);
  });
});
