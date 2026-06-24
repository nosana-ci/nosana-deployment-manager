import { describe, it, expect, vi, beforeEach } from "vitest";
import { Collection, ObjectId } from "mongodb";

const recoverUnits = vi.fn();
const applyOutcome = vi.fn();
const driveSend = vi.fn();

vi.mock("../../transactions/index.js", () => ({
  recoverUnits: (...a: unknown[]) => recoverUnits(...a),
}));
vi.mock("../unit.js", () => ({
  applyOutcome: (...a: unknown[]) => applyOutcome(...a),
  driveSend: (...a: unknown[]) => driveSend(...a),
}));

import { resumeExisting } from "./resumeExisting.js";
import type { UnitContext } from "../types.js";
import type { TaskDocument, TxRecord } from "../../../../types/index.js";

function ctx(aborted = false): UnitContext {
  const controller = new AbortController();
  if (aborted) controller.abort();
  return {
    tasks: {} as unknown as Collection<TaskDocument>,
    taskId: new ObjectId(),
    handlers: { onConfirmed: vi.fn(), onError: vi.fn() },
    signal: controller.signal,
  };
}

const record = (unit: number, status: TxRecord["status"], signature = ""): TxRecord => ({
  unit,
  signature,
  lastValidBlockHeight: 100,
  status,
  jobs: [`job-${unit}`],
});

describe("resumeExisting", () => {
  beforeEach(() => {
    recoverUnits.mockReset();
    applyOutcome.mockReset().mockImplementation((_ctx, _record, outcome) => outcome);
    driveSend.mockReset().mockResolvedValue({ result: "CONFIRMED", signature: "resent" });
  });

  it("turns already-confirmed records into CONFIRMED outcomes without re-running them", async () => {
    const result = await resumeExisting(ctx(), [record(0, "CONFIRMED", "sig-a")]);

    expect(result).toEqual([{ result: "CONFIRMED", signature: "sig-a", jobCount: 1 }]);
    expect(recoverUnits).not.toHaveBeenCalled();
    expect(applyOutcome).not.toHaveBeenCalled();
    expect(driveSend).not.toHaveBeenCalled();
  });

  it("re-broadcasts RESEND records and applies OUTCOME records from recovery", async () => {
    recoverUnits.mockResolvedValue(
      new Map([
        [1, { kind: "RESEND" }],
        [2, { kind: "OUTCOME", outcome: { result: "EXPIRED" } }],
      ])
    );

    const out = await resumeExisting(ctx(), [record(1, "SENT", "sig-1"), record(2, "SENT", "sig-2")]);

    expect(driveSend).toHaveBeenCalledTimes(1); // unit 1 (RESEND)
    expect(applyOutcome).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ unit: 2 }), {
      result: "EXPIRED",
    });
    expect(out).toContainEqual({ result: "CONFIRMED", signature: "resent" }); // driveSend result
    expect(out).toContainEqual({ result: "EXPIRED" });
  });

  it("keeps confirmed units and recovers the rest in one pass", async () => {
    recoverUnits.mockResolvedValue(new Map([[1, { kind: "RESEND" }]]));

    const out = await resumeExisting(ctx(), [record(0, "CONFIRMED", "sig-0"), record(1, "SENT")]);

    // recoverUnits is only handed the non-confirmed records
    expect(recoverUnits).toHaveBeenCalledWith([expect.objectContaining({ unit: 1 })]);
    expect(out).toContainEqual({ result: "CONFIRMED", signature: "sig-0", jobCount: 1 });
    expect(out).toHaveLength(2);
  });

  it("returns only confirmed outcomes and skips recovery when aborted", async () => {
    const out = await resumeExisting(ctx(true), [record(0, "CONFIRMED", "sig-0"), record(1, "SENT")]);

    expect(out).toEqual([{ result: "CONFIRMED", signature: "sig-0", jobCount: 1 }]);
    expect(recoverUnits).not.toHaveBeenCalled();
  });
});
