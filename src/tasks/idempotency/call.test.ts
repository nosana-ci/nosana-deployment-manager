import { describe, it, expect, vi } from "vitest";

import { runIdempotentCall } from "./call.js";
import { IdempotencyCode } from "./classify.js";

const coded = (code: string, statusCode = 409) => Object.assign(new Error(code), { code, statusCode });

describe("runIdempotentCall", () => {
  it("returns ok with the response on first success, using epoch 0", async () => {
    const attempt = vi.fn().mockResolvedValue({ job: "J" });
    const result = await runIdempotentCall({ taskId: "t", unit: 1, maxEpoch: 3, attempt });

    expect(result).toEqual({ kind: "ok", value: { job: "J" } });
    expect(attempt).toHaveBeenCalledExactlyOnceWith("t:1:0");
  });

  it("on EXPIRED bumps the epoch and re-posts under the next key", async () => {
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(coded(IdempotencyCode.EXPIRED))
      .mockResolvedValueOnce({ job: "J" });

    const result = await runIdempotentCall({ taskId: "t", unit: 0, maxEpoch: 3, attempt });

    expect(result).toEqual({ kind: "ok", value: { job: "J" } });
    expect(attempt).toHaveBeenNthCalledWith(1, "t:0:0");
    expect(attempt).toHaveBeenNthCalledWith(2, "t:0:1");
  });

  it("IN_PROGRESS is terminal-for-this-run as retry (same key re-issued on reclaim)", async () => {
    const attempt = vi.fn().mockRejectedValue(coded(IdempotencyCode.IN_PROGRESS));
    const result = await runIdempotentCall({ taskId: "t", unit: 0, maxEpoch: 3, attempt });

    expect(result).toEqual({ kind: "retry", retryAfterMs: undefined });
    expect(attempt).toHaveBeenCalledOnce(); // does NOT bump epoch
  });

  it("surfaces the CM Retry-After (seconds) as retryAfterMs on a retry", async () => {
    const err = Object.assign(coded(IdempotencyCode.IN_PROGRESS), { retryAfter: 5 });
    const attempt = vi.fn().mockRejectedValue(err);
    const result = await runIdempotentCall({ taskId: "t", unit: 0, maxEpoch: 3, attempt });

    expect(result).toEqual({ kind: "retry", retryAfterMs: 5000 });
  });

  it("PAYLOAD_MISMATCH is fatal and carries a message", async () => {
    const attempt = vi.fn().mockRejectedValue(coded(IdempotencyCode.PAYLOAD_MISMATCH));
    const result = await runIdempotentCall({ taskId: "t", unit: 0, maxEpoch: 3, attempt });

    expect(result.kind).toBe("fatal");
  });

  it("degrades to retry when every epoch expires in one run", async () => {
    const attempt = vi.fn().mockRejectedValue(coded(IdempotencyCode.EXPIRED));
    const result = await runIdempotentCall({ taskId: "t", unit: 0, maxEpoch: 2, attempt });

    expect(result).toEqual({ kind: "retry" });
    expect(attempt).toHaveBeenCalledTimes(3); // epochs 0,1,2
  });
});
