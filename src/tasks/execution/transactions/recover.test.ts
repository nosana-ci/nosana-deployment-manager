import { describe, it, expect, vi, beforeEach } from "vitest";

import { TxRecord } from "../../../types/index.js";

const getSignatureStatuses = vi.fn();
const getBlockHeight = vi.fn();
const sendTransaction = vi.fn();

vi.mock("../../../kit/index.js", () => ({
  getKit: () => ({
    solana: { rpc: { getSignatureStatuses, getBlockHeight, sendTransaction } },
  }),
}));

import { recoverUnits } from "./recover.js";

type Status = { confirmationStatus?: string; err?: unknown } | null;

const sendable = (value: unknown) => ({ send: () => Promise.resolve(value) });

/** Mock getSignatureStatuses to resolve each requested signature from a map. */
const statusesFrom = (bySig: Record<string, Status>) =>
  getSignatureStatuses.mockImplementation((sigs: string[]) =>
    sendable({ value: sigs.map((sig) => bySig[sig] ?? null) })
  );

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

describe("recoverUnits", () => {
  beforeEach(() => {
    getSignatureStatuses.mockReset();
    getBlockHeight.mockReset();
    sendTransaction.mockReset();
  });

  it("returns an empty map for no records (no RPC calls)", async () => {
    const actions = await recoverUnits([]);

    expect(actions.size).toBe(0);
    expect(getBlockHeight).not.toHaveBeenCalled();
    expect(getSignatureStatuses).not.toHaveBeenCalled();
  });

  it("flags a confirmed signature as a terminal CONFIRMED outcome", async () => {
    getBlockHeight.mockReturnValue(sendable(100n));
    statusesFrom({ "sig-1": { confirmationStatus: "confirmed" } });

    const actions = await recoverUnits([record({ unit: 0, signature: "sig-1", status: "SENT" })]);

    expect(actions.get(0)).toEqual({
      kind: "OUTCOME",
      outcome: { result: "CONFIRMED", signature: "sig-1" },
    });
  });

  it("flags a reverted signature as a terminal ERROR outcome", async () => {
    getBlockHeight.mockReturnValue(sendable(100n));
    statusesFrom({ "sig-2": { err: { InstructionError: [0, "X"] } } });

    const actions = await recoverUnits([record({ unit: 0, signature: "sig-2", status: "SENT" })]);

    expect(actions.get(0)?.kind).toBe("OUTCOME");
    expect((actions.get(0) as { outcome: { result: string } }).outcome.result).toBe("ERROR");
  });

  it("flags an unlanded tx past its lastValidBlockHeight as EXPIRED", async () => {
    getBlockHeight.mockReturnValue(sendable(201n)); // > 200
    statusesFrom({ "sig-3": null });

    const actions = await recoverUnits([record({ unit: 0, signature: "sig-3", status: "SENT" })]);

    expect((actions.get(0) as { outcome: { result: string } }).outcome.result).toBe("EXPIRED");
  });

  it("flags an in-window, unseen tx for RESEND", async () => {
    getBlockHeight.mockReturnValue(sendable(100n)); // < 200, still in window
    statusesFrom({ "sig-4": null });

    const actions = await recoverUnits([record({ unit: 0, signature: "sig-4", status: "SENT" })]);

    expect(actions.get(0)).toEqual({ kind: "RESEND" });
  });

  it("flags a record with no blob as EXPIRED (nothing left to send)", async () => {
    getBlockHeight.mockReturnValue(sendable(100n));
    getSignatureStatuses.mockReturnValue(sendable({ value: [] }));

    const actions = await recoverUnits([
      record({ unit: 0, signature: "", blob: null, status: "SENT" }),
    ]);

    expect((actions.get(0) as { outcome: { result: string } }).outcome.result).toBe("EXPIRED");
  });

  it("checks the whole cohort with ONE getBlockHeight and ONE batched status read", async () => {
    getBlockHeight.mockReturnValue(sendable(100n));
    statusesFrom({ "sig-a": null, "sig-b": null, "sig-c": null });

    const actions = await recoverUnits([
      record({ unit: 0, signature: "sig-a", status: "SENT" }),
      record({ unit: 1, signature: "sig-b", status: "SENT" }),
      record({ unit: 2, signature: "sig-c", status: "SENT" }),
    ]);

    expect(getBlockHeight).toHaveBeenCalledOnce();
    expect(getSignatureStatuses).toHaveBeenCalledOnce();
    expect(getSignatureStatuses).toHaveBeenCalledWith(["sig-a", "sig-b", "sig-c"]);
    expect([...actions.values()].every((a) => a.kind === "RESEND")).toBe(true);
  });
});
