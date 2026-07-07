import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  getAppMode,
  shouldRunApi,
  shouldRunWorker,
  shouldRunListeners,
  shouldRunConsumer,
} from "./mode.js";

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

  it.each(["all", "api", "worker", "listeners", "consumer"] as const)(
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
  it.each([
    ["all", true],
    ["api", true],
    ["worker", false],
    ["listeners", false],
    ["consumer", false],
  ] as const)("returns %s for '%s'", (mode, expected) => {
    expect(shouldRunApi(mode)).toBe(expected);
  });
});

describe("shouldRunListeners", () => {
  it.each([
    ["all", true],
    ["worker", true],
    ["listeners", true],
    ["consumer", false],
    ["api", false],
  ] as const)("returns %s for '%s'", (mode, expected) => {
    expect(shouldRunListeners(mode)).toBe(expected);
  });
});

describe("shouldRunConsumer", () => {
  it.each([
    ["all", true],
    ["worker", true],
    ["consumer", true],
    ["listeners", false],
    ["api", false],
  ] as const)("returns %s for '%s'", (mode, expected) => {
    expect(shouldRunConsumer(mode)).toBe(expected);
  });
});

describe("shouldRunWorker", () => {
  it.each([
    ["all", true],
    ["worker", true],
    ["listeners", true],
    ["consumer", true],
    ["api", false],
  ] as const)("returns %s for '%s'", (mode, expected) => {
    expect(shouldRunWorker(mode)).toBe(expected);
  });
});
