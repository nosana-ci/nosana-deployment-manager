import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { TxRecord } from "../../../types/index.js";

const getSignatureStatuses = vi.fn();
const getBlockHeight = vi.fn();
const sendTransaction = vi.fn();

vi.mock("../../../kit/index.js", () => ({
  getKit: () => ({
    solana: { rpc: { getSignatureStatuses, getBlockHeight, sendTransaction } },
  }),
}));

import { sendUnit } from "./send.js";
import { _resetTracker } from "../tracker/index.js";

const sendable = (value: unknown) => ({ send: () => Promise.resolve(value) });

function record(overrides: Partial<TxRecord> = {}): TxRecord {
  return {
    unit: 0,
    signature: "",
    lastValidBlockHeight: 200,
    status: "SIGNED",
    blob: "BASE64_BLOB",
    ...overrides,
  };
}

describe("sendUnit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetTracker();
    getSignatureStatuses.mockReset();
    getBlockHeight.mockReset();
    sendTransaction.mockReset();
  });

  afterEach(() => {
    _resetTracker();
    vi.useRealTimers();
  });

  it("broadcasts the blob, then confirms via the shared tracker", async () => {
    getBlockHeight.mockReturnValue(sendable(100n)); // in window
    sendTransaction.mockReturnValue(sendable("sig-new"));
    getSignatureStatuses.mockReturnValue(sendable({ value: [{ confirmationStatus: "finalized" }] }));

    const pending = sendUnit(record());
    await vi.advanceTimersByTimeAsync(2_000); // drive one tracker sweep
    const result = await pending;

    expect(sendTransaction).toHaveBeenCalledOnce();
    expect(result).toEqual({ result: "CONFIRMED", signature: "sig-new" });
  });

  it("bails out as ABORTED when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await sendUnit(record(), controller.signal);

    expect(result.result).toBe("ABORTED");
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("returns EXPIRED when there is no blob to send", async () => {
    const result = await sendUnit(record({ blob: null }));

    expect(result.result).toBe("EXPIRED");
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("returns ERROR when preflight rejects deterministically (insufficient funds)", async () => {
    sendTransaction.mockReturnValue({
      send: () =>
        Promise.reject(new Error("Transaction simulation failed: Attempt to debit an account but found no record of a prior credit")),
    });

    const result = await sendUnit(record());

    expect(result.result).toBe("ERROR");
  });

  it("returns EXPIRED (retry) when the broadcast throws a transient RPC error", async () => {
    sendTransaction.mockReturnValue({
      send: () => Promise.reject(new Error("failed to send transaction: Blockhash not found")),
    });

    const result = await sendUnit(record());

    expect(result.result).toBe("EXPIRED");
  });

  it("returns ERROR for an unrecognized broadcast throw (default terminal)", async () => {
    sendTransaction.mockReturnValue({ send: () => Promise.reject(new Error("rpc down")) });

    const result = await sendUnit(record());

    expect(result.result).toBe("ERROR");
  });
});
