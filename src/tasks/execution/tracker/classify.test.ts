import { describe, it, expect } from "vitest";

import { classifySignatureStatus } from "./classify.js";

describe("classifySignatureStatus", () => {
  it("reads a missing status as pending (not confirmed)", () => {
    expect(classifySignatureStatus(undefined)).toEqual({ confirmed: false });
    expect(classifySignatureStatus(null)).toEqual({ confirmed: false });
  });

  it("treats confirmed and finalized as confirmed", () => {
    expect(classifySignatureStatus({ confirmationStatus: "confirmed" })).toEqual({
      confirmed: true,
    });
    expect(classifySignatureStatus({ confirmationStatus: "finalized" })).toEqual({
      confirmed: true,
    });
  });

  it("treats processed (or unknown) as not yet confirmed", () => {
    expect(classifySignatureStatus({ confirmationStatus: "processed" })).toEqual({
      confirmed: false,
    });
  });

  it("serializes a plain transaction error", () => {
    expect(classifySignatureStatus({ err: { InstructionError: [0, "X"] } })).toEqual({
      confirmed: false,
      error: '{"InstructionError":[0,"X"]}',
    });
  });

  it("serializes an error containing BigInt without throwing", () => {
    // @solana/kit deserializes u64 fields in errors as BigInt; JSON.stringify
    // would otherwise throw "Do not know how to serialize a BigInt".
    const result = classifySignatureStatus({
      err: { InsufficientFundsForRent: { account_index: 3n } },
    });

    expect(result.confirmed).toBe(false);
    expect(result.error).toBe('{"InsufficientFundsForRent":{"account_index":"3"}}');
  });
});
