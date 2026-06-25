import { describe, it, expect } from "vitest";

import { computeCooldown, retryCooldownMs, rapidCompletionCooldownMs } from "./cooldown.js";
import { getConfig } from "../../config/index.js";

const ladder = { baseMs: 100, maxMs: 1000, multiplier: 2 };

describe("computeCooldown", () => {
  it("returns the base for the first retry (n = 0)", () => {
    expect(computeCooldown(0, ladder)).toBe(100);
  });

  it("escalates geometrically with n", () => {
    expect(computeCooldown(1, ladder)).toBe(200);
    expect(computeCooldown(2, ladder)).toBe(400);
    expect(computeCooldown(3, ladder)).toBe(800);
  });

  it("caps at maxMs", () => {
    expect(computeCooldown(4, ladder)).toBe(1000); // 1600 -> capped
    expect(computeCooldown(50, ladder)).toBe(1000);
  });

  it("clamps a negative n to the base", () => {
    expect(computeCooldown(-3, ladder)).toBe(100);
  });
});

describe("retryCooldownMs", () => {
  it("uses the standard ladder for a non-funds error", () => {
    const config = getConfig();
    expect(retryCooldownMs(0, false)).toBe(config.retry_cooldown_base_ms);
  });

  it("uses the slower funds ladder for an insufficient-funds error", () => {
    const config = getConfig();
    expect(retryCooldownMs(0, true)).toBe(config.insufficient_funds_cooldown_base_ms);
    // The funds ladder is deliberately slower than the standard one.
    expect(retryCooldownMs(0, true)).toBeGreaterThan(retryCooldownMs(0, false));
  });

  it("escalates with the retry count", () => {
    expect(retryCooldownMs(1, false)).toBeGreaterThan(retryCooldownMs(0, false));
  });
});

describe("rapidCompletionCooldownMs", () => {
  it("returns the base for the first rapid round and escalates", () => {
    const config = getConfig();
    expect(rapidCompletionCooldownMs(0)).toBe(config.rapid_completion_cooldown_base_ms);
    expect(rapidCompletionCooldownMs(2)).toBeGreaterThan(rapidCompletionCooldownMs(0));
  });
});
