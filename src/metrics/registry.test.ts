import { describe, it, expect } from "vitest";

import { createRegistry, SERVICE_NAME } from "./registry.js";

describe("createRegistry", () => {
  it("exposes the service constant label in metrics output", async () => {
    const { registry } = createRegistry("api");
    const output = await registry.metrics();
    expect(output).toContain(`service="${SERVICE_NAME}"`);
  });

  it("exposes the app_mode constant label matching the argument", async () => {
    const { registry } = createRegistry("api");
    const output = await registry.metrics();
    expect(output).toContain('app_mode="api"');
  });

  it("exposes app_mode=worker when created with worker mode", async () => {
    const { registry } = createRegistry("worker");
    const output = await registry.metrics();
    expect(output).toContain('app_mode="worker"');
  });

  it("includes default process metrics", async () => {
    const { registry } = createRegistry("api");
    const output = await registry.metrics();
    expect(output).toContain("process_cpu_user_seconds_total");
  });

  it("includes http_requests_total metric definition", async () => {
    const { registry } = createRegistry("api");
    const output = await registry.metrics();
    expect(output).toContain("http_requests_total");
  });

  it("includes http_request_duration_seconds metric definition", async () => {
    const { registry } = createRegistry("api");
    const output = await registry.metrics();
    expect(output).toContain("http_request_duration_seconds");
  });

  it("returns separate http counter and histogram handles", () => {
    const { http } = createRegistry("api");
    expect(http.requestsTotal).toBeDefined();
    expect(http.requestDuration).toBeDefined();
  });

  it("uses an isolated registry (does not pollute the default singleton)", async () => {
    const { registry: r1 } = createRegistry("api");
    const { registry: r2 } = createRegistry("worker");
    // Each registry produces its own metrics string
    const out1 = await r1.metrics();
    const out2 = await r2.metrics();
    expect(out1).toContain('app_mode="api"');
    expect(out2).toContain('app_mode="worker"');
  });
});
