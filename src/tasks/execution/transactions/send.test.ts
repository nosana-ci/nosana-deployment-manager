import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { TxRecord } from "../../../types/index.js";

const getSignatureStatuses = vi.fn();
const getBlockHeight = vi.fn();
const sendTransaction = vi.fn();
const simulateTransaction = vi.fn();

vi.mock("../../../kit/index.js", () => ({
  getKit: () => ({
    solana: { rpc: { getSignatureStatuses, getBlockHeight, sendTransaction, simulateTransaction } },
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
    simulateTransaction.mockReset().mockReturnValue(sendable({ value: { err: null, logs: [] } }));
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

    expect(simulateTransaction).toHaveBeenCalledWith("BASE64_BLOB", { encoding: "base64", commitment: "confirmed" });
    expect(simulateTransaction.mock.invocationCallOrder[0]).toBeLessThan(sendTransaction.mock.invocationCallOrder[0]);
    expect(sendTransaction).toHaveBeenCalledOnce();
    expect(result).toEqual({ result: "CONFIRMED", signature: "sig-new" });
  });

  describe("simulation (an RPC may ignore preflight and drop a doomed tx)", () => {
    it("an unfunded vault is an ERROR before anything is broadcast", async () => {
      // What Ironforge answered in prd for a vault that never held SOL.
      simulateTransaction.mockReturnValue(sendable({ value: { err: "AccountNotFound", logs: [] } }));

      const result = await sendUnit(record({ signature: "sig-signed" }));

      expect(result).toEqual({
        result: "ERROR",
        signature: "sig-signed",
        error: 'Transaction simulation failed: "AccountNotFound"',
      });
      expect(sendTransaction).not.toHaveBeenCalled();
    });

    it("a program error carries the last log lines", async () => {
      simulateTransaction.mockReturnValue(
        sendable({
          value: {
            err: { InstructionError: [2, { Custom: 1n }] },
            logs: ["Program a invoke [1]", "Program log: Instruction: Transfer", "Program log: Error: insufficient funds", "Program a failed"],
          },
        })
      );

      const result = await sendUnit(record());

      expect(result).toMatchObject({
        result: "ERROR",
        error:
          'Transaction simulation failed: {"InstructionError":[2,{"Custom":"1"}]} ' +
          "(Program log: Instruction: Transfer | Program log: Error: insufficient funds | Program a failed)",
      });
      expect(sendTransaction).not.toHaveBeenCalled();
    });

    it("an unknown blockhash is EXPIRED (re-sign), not an error", async () => {
      simulateTransaction.mockReturnValue(sendable({ value: { err: "BlockhashNotFound", logs: [] } }));

      expect((await sendUnit(record())).result).toBe("EXPIRED");
      expect(sendTransaction).not.toHaveBeenCalled();
    });

    it("an already-landed tx (a resend) goes on to send and confirm", async () => {
      simulateTransaction.mockReturnValue(sendable({ value: { err: "AlreadyProcessed", logs: [] } }));
      getBlockHeight.mockReturnValue(sendable(100n));
      sendTransaction.mockReturnValue(sendable("sig-landed"));
      getSignatureStatuses.mockReturnValue(sendable({ value: [{ confirmationStatus: "finalized" }] }));

      const pending = sendUnit(record());
      await vi.advanceTimersByTimeAsync(2_000);

      expect(await pending).toEqual({ result: "CONFIRMED", signature: "sig-landed" });
    });

    it("sends anyway when the simulation itself cannot run", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      simulateTransaction.mockReturnValue({ send: () => Promise.reject(new Error("rpc down")) });
      getBlockHeight.mockReturnValue(sendable(100n));
      sendTransaction.mockReturnValue(sendable("sig-new"));
      getSignatureStatuses.mockReturnValue(sendable({ value: [{ confirmationStatus: "finalized" }] }));

      const pending = sendUnit(record());
      await vi.advanceTimersByTimeAsync(2_000);

      expect(await pending).toEqual({ result: "CONFIRMED", signature: "sig-new" });
    });
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
