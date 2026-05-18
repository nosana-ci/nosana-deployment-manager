import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { getAppMode, shouldRunApi, shouldRunWorker } from "./mode.js";

describe("getAppMode", () => {
  const originalAppMode = process.env.APP_MODE;

  beforeEach(() => {
    delete process.env.APP_MODE;
  });

  afterEach(() => {
    if (originalAppMode !== undefined) {
      process.env.APP_MODE = originalAppMode;
    } else {
      delete process.env.APP_MODE;
    }
  });

  it("returns 'all' when APP_MODE is not set", () => {
    expect(getAppMode()).toBe("all");
  });

  it.each(["all", "api", "worker"] as const)(
    "returns '%s' when APP_MODE is set to '%s'",
    (mode) => {
      process.env.APP_MODE = mode;
      expect(getAppMode()).toBe(mode);
    },
  );

  it("throws an error for invalid value 'invalid'", () => {
    process.env.APP_MODE = "invalid";
    expect(() => getAppMode()).toThrow('Invalid APP_MODE "invalid"');
  });

  it("throws an error for uppercase 'API'", () => {
    process.env.APP_MODE = "API";
    expect(() => getAppMode()).toThrow('Invalid APP_MODE "API"');
  });

  it("throws an error for empty string", () => {
    process.env.APP_MODE = "";
    expect(() => getAppMode()).toThrow('Invalid APP_MODE ""');
  });
});

describe("shouldRunApi", () => {
  it("returns true for 'all'", () => {
    expect(shouldRunApi("all")).toBe(true);
  });

  it("returns true for 'api'", () => {
    expect(shouldRunApi("api")).toBe(true);
  });

  it("returns false for 'worker'", () => {
    expect(shouldRunApi("worker")).toBe(false);
  });
});

describe("shouldRunWorker", () => {
  it("returns true for 'all'", () => {
    expect(shouldRunWorker("all")).toBe(true);
  });

  it("returns true for 'worker'", () => {
    expect(shouldRunWorker("worker")).toBe(true);
  });

  it("returns false for 'api'", () => {
    expect(shouldRunWorker("api")).toBe(false);
  });
});
