import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { DeploymentsConfig } from "../types/index.js";

const FRPS_ENV_KEYS = [
  "FRPS_INTERNAL_ADDRESS",
  "FRPS_API_KEY",
  "FRPS_WATCHING_ENABLED",
  "FRPS_UNHEALTHY_GRACE_MS",
] as const;

const originalEnv = { ...process.env };

/** `defaultConfig` reads env at module load, so each case needs a fresh import. */
async function loadConfig(env: Partial<Record<(typeof FRPS_ENV_KEYS)[number], string>>): Promise<DeploymentsConfig> {
  for (const key of FRPS_ENV_KEYS) delete process.env[key];
  Object.assign(process.env, env);

  vi.resetModules();
  const { defaultConfig } = await import("./defaultConfig.js");
  return defaultConfig.devnet;
}

describe("defaultConfig FRPS settings", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("leaves FRPS watching enabled but unconfigured by default", async () => {
    const config = await loadConfig({});

    expect(config.frps_watching_enabled).toBe(true);
    // No default address: the listener has to be told where FRPS is, so an
    // unconfigured environment simply doesn't subscribe.
    expect(config.frps_internal_address).toBe("");
    expect(config.frps_api_key).toBeUndefined();
    expect(config.frps_unhealthy_grace_ms).toBe(60_000);
  });

  it("treats FRPS_WATCHING_ENABLED=false as the kill-switch", async () => {
    expect((await loadConfig({ FRPS_WATCHING_ENABLED: "false" })).frps_watching_enabled).toBe(false);
    expect((await loadConfig({ FRPS_WATCHING_ENABLED: "true" })).frps_watching_enabled).toBe(true);
  });

  it("reads the address, api key and grace period from the environment", async () => {
    const config = await loadConfig({
      FRPS_INTERNAL_ADDRESS: "frps.internal",
      FRPS_API_KEY: "secret",
      FRPS_UNHEALTHY_GRACE_MS: "5000",
    });

    expect(config.frps_internal_address).toBe("frps.internal");
    expect(config.frps_api_key).toBe("secret");
    expect(config.frps_unhealthy_grace_ms).toBe(5_000);
  });
});
