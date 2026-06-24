import { describe, it, expect } from "vitest";

import { pendingSlots } from "./pendingSlots.js";
import type { TxRecord } from "../../../types/index.js";

const confirmed = (unit: number): TxRecord => ({
  unit,
  signature: `sig-${unit}`,
  lastValidBlockHeight: 0,
  status: "CONFIRMED",
  jobs: [`job-${unit}`],
});

describe("pendingSlots", () => {
  it("first attempt (no records) → every slot 0..target-1", () => {
    expect(pendingSlots([], 6)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(pendingSlots(undefined, 3)).toEqual([0, 1, 2]);
  });

  it("all confirmed → nothing left to issue", () => {
    expect(pendingSlots([0, 1, 2].map(confirmed), 3)).toEqual([]);
  });

  it("contiguous partial: 0,1,2 confirmed of 6 → re-issue 3,4,5", () => {
    expect(pendingSlots([0, 1, 2].map(confirmed), 6)).toEqual([3, 4, 5]);
  });

  it("NON-contiguous partial: 0,2,4 confirmed of 6 → re-issue exactly 1,3,5 (no gap skipped)", () => {
    // This is the case a `target - confirmed.length` offset would get wrong.
    expect(pendingSlots([0, 2, 4].map(confirmed), 6)).toEqual([1, 3, 5]);
  });

  it("ignores non-CONFIRMED records (only landed slots are skipped)", () => {
    const records: TxRecord[] = [
      confirmed(0),
      { unit: 1, signature: "", lastValidBlockHeight: 0, status: "SENT" },
    ];
    // slot 1 is SENT, not CONFIRMED → still pending
    expect(pendingSlots(records, 3)).toEqual([1, 2]);
  });
});
