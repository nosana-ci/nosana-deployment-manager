import { describe, it, expect } from "vitest";

import { evaluateEntries } from "./sweep.js";
import { Entry, SignatureStatusValue } from "./types.js";

const entry = (lastValidBlockHeight: number): Entry => ({
  lastValidBlockHeight,
  resolve: () => {},
});

const entries = (...rows: Array<[string, number]>) =>
  new Map<string, Entry>(rows.map(([sig, lvbh]) => [sig, entry(lvbh)]));

const statuses = (rows: Record<string, SignatureStatusValue>) =>
  new Map<string, SignatureStatusValue>(Object.entries(rows));

describe("evaluateEntries", () => {
  it("settles confirmed and reverted signatures", () => {
    const result = evaluateEntries(
      entries(["sig-ok", 200], ["sig-bad", 200]),
      100n,
      statuses({ "sig-ok": { confirmationStatus: "finalized" }, "sig-bad": { err: { x: 1 } } })
    );

    expect(result).toContainEqual({ signature: "sig-ok", result: { outcome: "CONFIRMED" } });
    expect(result.find((s) => s.signature === "sig-bad")?.result.outcome).toBe("ERROR");
  });

  it("expires an unseen signature only once height passes its lastValidBlockHeight", () => {
    const inWindow = evaluateEntries(entries(["sig", 200]), 100n, statuses({ sig: null }));
    expect(inWindow).toEqual([]);

    const expired = evaluateEntries(entries(["sig", 200]), 201n, statuses({ sig: null }));
    expect(expired).toEqual([{ signature: "sig", result: { outcome: "EXPIRED" } }]);
  });

  it("prefers confirmation over expiry at the boundary", () => {
    const result = evaluateEntries(
      entries(["sig", 200]),
      999n, // well past expiry
      statuses({ sig: { confirmationStatus: "confirmed" } })
    );

    expect(result).toEqual([{ signature: "sig", result: { outcome: "CONFIRMED" } }]);
  });
});
