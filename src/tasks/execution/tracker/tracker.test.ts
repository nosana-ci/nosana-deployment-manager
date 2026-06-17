import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getSignatureStatuses = vi.fn();
const getBlockHeight = vi.fn();

vi.mock("../../../kit/index.js", () => ({
  getKit: () => ({ solana: { rpc: { getSignatureStatuses, getBlockHeight } } }),
}));

import { trackSignature, _resetTracker } from "./index.js";

const sendable = (value: unknown) => ({ send: () => Promise.resolve(value) });

describe("transaction tracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetTracker();
    getSignatureStatuses.mockReset();
    getBlockHeight.mockReset();
  });

  afterEach(() => {
    _resetTracker();
    vi.useRealTimers();
  });

  it("resolves CONFIRMED when the status shows confirmed", async () => {
    getBlockHeight.mockReturnValue(sendable(100n));
    getSignatureStatuses.mockReturnValue(sendable({ value: [{ confirmationStatus: "confirmed" }] }));

    const pending = trackSignature("sig-a", 200);
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(pending).resolves.toEqual({ outcome: "CONFIRMED" });
  });

  it("resolves EXPIRED once height passes lastValidBlockHeight and it never confirmed", async () => {
    getBlockHeight.mockReturnValue(sendable(201n)); // > 200
    getSignatureStatuses.mockReturnValue(sendable({ value: [null] }));

    const pending = trackSignature("sig-b", 200);
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(pending).resolves.toEqual({ outcome: "EXPIRED" });
  });

  it("resolves ABORTED immediately when the signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(trackSignature("sig-c", 200, controller.signal)).resolves.toEqual({
      outcome: "ABORTED",
    });
    expect(getBlockHeight).not.toHaveBeenCalled();
  });

  it("batches getSignatureStatuses into chunks of at most 256", async () => {
    getBlockHeight.mockReturnValue(sendable(100n)); // in window -> nothing expires
    getSignatureStatuses.mockImplementation((sigs: string[]) =>
      sendable({ value: sigs.map(() => null) })
    );

    // 300 in-flight signatures -> 256 + 44 -> 2 status calls, 1 height call.
    for (let i = 0; i < 300; i++) void trackSignature(`sig-${i}`, 200);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(getBlockHeight).toHaveBeenCalledOnce();
    expect(getSignatureStatuses).toHaveBeenCalledTimes(2);
  });
});
