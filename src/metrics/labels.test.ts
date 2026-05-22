import { describe, it, expect } from "vitest";

import {
  extractRoutePattern,
  statusRange,
  METRICS_ROUTE_PATH,
} from "./labels.js";

describe("extractRoutePattern", () => {
  it("replaces a numeric segment with :id", () => {
    expect(extractRoutePattern("/jobs/12345")).toBe("/jobs/:id");
  });

  it("replaces a multi-digit numeric segment with :id", () => {
    expect(extractRoutePattern("/deployments/99/tasks")).toBe(
      "/deployments/:id/tasks",
    );
  });

  it("replaces a 64-char alphanumeric segment with :invitation-token", () => {
    const token = "a".repeat(64);
    expect(extractRoutePattern(`/invitations/${token}`)).toBe(
      "/invitations/:invitation-token",
    );
  });

  it("replaces a Solana address-length segment (32-44 chars) with :address", () => {
    const pubkey = "9HXtaBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890AB";
    expect(pubkey.length).toBeGreaterThanOrEqual(32);
    expect(pubkey.length).toBeLessThanOrEqual(44);
    expect(extractRoutePattern(`/nodes/${pubkey}`)).toBe("/nodes/:address");
  });

  it("strips a trailing slash before processing", () => {
    expect(extractRoutePattern("/jobs/")).toBe("/jobs");
  });

  it("strips query string before processing", () => {
    expect(extractRoutePattern("/jobs/123?page=1")).toBe("/jobs/:id");
  });

  it("handles multi-segment paths with mixed patterns", () => {
    expect(
      extractRoutePattern("/deployments/42/jobs/9HXtaBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890AB"),
    ).toBe("/deployments/:id/jobs/:address");
  });

  it("preserves literal non-dynamic segments unchanged", () => {
    expect(extractRoutePattern("/health")).toBe("/health");
  });

  it("preserves root path", () => {
    expect(extractRoutePattern("/")).toBe("/");
  });
});

describe("statusRange", () => {
  it("returns 1xx for status 100", () => {
    expect(statusRange(100)).toBe("1xx");
  });

  it("returns 2xx for status 200", () => {
    expect(statusRange(200)).toBe("2xx");
  });

  it("returns 3xx for status 301", () => {
    expect(statusRange(301)).toBe("3xx");
  });

  it("returns 4xx for status 404", () => {
    expect(statusRange(404)).toBe("4xx");
  });

  it("returns 5xx for status 500", () => {
    expect(statusRange(500)).toBe("5xx");
  });

  it("returns 5xx for status 503", () => {
    expect(statusRange(503)).toBe("5xx");
  });
});

describe("METRICS_ROUTE_PATH", () => {
  it("is the /metrics string constant", () => {
    expect(METRICS_ROUTE_PATH).toBe("/metrics");
  });
});
