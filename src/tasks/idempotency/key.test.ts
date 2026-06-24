import { describe, it, expect } from "vitest";

import { buildIdempotencyKey } from "./key.js";

describe("buildIdempotencyKey", () => {
  it("composes taskId, unit and epoch into a stable string", () => {
    expect(buildIdempotencyKey("abc123", 0, 0)).toBe("abc123:0:0");
    expect(buildIdempotencyKey("abc123", 2, 1)).toBe("abc123:2:1");
  });

  it("is deterministic: the same inputs always yield the same key", () => {
    expect(buildIdempotencyKey("t", 3, 4)).toBe(buildIdempotencyKey("t", 3, 4));
  });

  it("distinguishes every component so distinct units/epochs never collide", () => {
    const keys = new Set([
      buildIdempotencyKey("t", 0, 0),
      buildIdempotencyKey("t", 1, 0),
      buildIdempotencyKey("t", 0, 1),
      buildIdempotencyKey("u", 0, 0),
    ]);
    expect(keys.size).toBe(4);
  });

  it("accepts a string unit (STOP keys on the job address, not a positional slot)", () => {
    const jobA = "CA5pMpqkYFKtme7K31pNB1s62X2SdhEv1nN9RdxKCpuQ";
    const jobB = "9RdxKCpuQCA5pMpqkYFKtme7K31pNB1s62X2SdhEv1nN";
    expect(buildIdempotencyKey("t", jobA, 0)).toBe(`t:${jobA}:0`);
    // The same job in the same task is the same logical stop → same key on reclaim.
    expect(buildIdempotencyKey("t", jobA, 0)).toBe(buildIdempotencyKey("t", jobA, 0));
    // Different jobs never collide regardless of the order they were enumerated.
    expect(buildIdempotencyKey("t", jobA, 0)).not.toBe(buildIdempotencyKey("t", jobB, 0));
  });
});
