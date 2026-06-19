import { describe, it, expect, vi } from "vitest";
import { Collection, ObjectId } from "mongodb";

import { UnitOutcome } from "../transactions/index.js";
import { UnitContext, applyOutcome, markRecord, tally } from "./unit.js";
import { TaskDocument } from "../../../types/index.js";

function fakeCtx() {
  const updateOne = vi.fn(async () => ({ acknowledged: true }));
  const onConfirmed = vi.fn(async () => {});
  const onError = vi.fn(async () => {});
  const ctx: UnitContext = {
    tasks: { updateOne } as unknown as Collection<TaskDocument>,
    taskId: new ObjectId(),
    handlers: { onConfirmed, onError },
    signal: new AbortController().signal,
  };
  return { ctx, updateOne, onConfirmed, onError };
}

const record = (overrides = {}) => ({
  unit: 0,
  signature: "",
  lastValidBlockHeight: 200,
  status: "SIGNED" as const,
  ...overrides,
});

describe("tally", () => {
  it("counts confirmed and errored outcomes and ignores expired", () => {
    const outcomes: UnitOutcome[] = [
      { result: "CONFIRMED", signature: "a" },
      { result: "CONFIRMED", signature: "b" },
      { result: "ERROR", error: "x" },
      { result: "EXPIRED" },
    ];
    expect(tally(outcomes, false)).toEqual({ confirmed: 2, errored: 1, aborted: false });
  });

  it("counts JOBS, not units: a bulked outcome adds its jobCount", () => {
    const outcomes: UnitOutcome[] = [
      { result: "CONFIRMED", signature: "a", jobCount: 7 }, // one bulked tx, 7 jobs
      { result: "CONFIRMED", signature: "b" }, // no jobCount → 1 (e.g. API path)
      { result: "ERROR", error: "x" },
    ];
    expect(tally(outcomes, false)).toEqual({ confirmed: 8, errored: 1, aborted: false });
  });

  it("reports aborted from an ABORTED outcome or the seed", () => {
    expect(tally([{ result: "ABORTED" }], false).aborted).toBe(true);
    expect(tally([], true).aborted).toBe(true);
    expect(tally([{ result: "CONFIRMED", signature: "a" }], false).aborted).toBe(false);
  });
});

describe("markRecord", () => {
  it("builds positional array-filter paths for each field", () => {
    const { ctx, updateOne } = fakeCtx();

    markRecord(ctx, 3, { status: "CONFIRMED", signature: "sig", blob: null });

    expect(updateOne).toHaveBeenCalledWith(
      { _id: ctx.taskId },
      {
        $set: {
          "transactions.$[u].status": "CONFIRMED",
          "transactions.$[u].signature": "sig",
          "transactions.$[u].blob": null,
        },
      },
      { arrayFilters: [{ "u.unit": 3 }] }
    );
  });
});

describe("applyOutcome", () => {
  it("CONFIRMED: marks the record confirmed and runs onConfirmed", async () => {
    const { ctx, updateOne, onConfirmed } = fakeCtx();

    const out = await applyOutcome(ctx, record({ unit: 1, jobs: ["job-1"], runs: ["run-1"] }), {
      result: "CONFIRMED",
      signature: "sig-1",
    });

    expect(out).toEqual({ result: "CONFIRMED", signature: "sig-1", jobCount: 1 });
    expect(updateOne).toHaveBeenCalledOnce();
    expect(onConfirmed).toHaveBeenCalledWith(1, "sig-1", "job-1", "run-1");
  });

  it("CONFIRMED: fans onConfirmed out once per packed job and reports the job count", async () => {
    const { ctx, updateOne, onConfirmed } = fakeCtx();

    const out = await applyOutcome(
      ctx,
      record({ unit: 4, jobs: ["j-a", "j-b", "j-c"], runs: ["r-a", "r-b", "r-c"] }),
      { result: "CONFIRMED", signature: "sig-bulk" }
    );

    expect(out).toEqual({ result: "CONFIRMED", signature: "sig-bulk", jobCount: 3 });
    // One record patch (status/blob), one onConfirmed per job in the bucket.
    expect(updateOne).toHaveBeenCalledOnce();
    expect(onConfirmed).toHaveBeenCalledTimes(3);
    expect(onConfirmed).toHaveBeenNthCalledWith(1, 4, "sig-bulk", "j-a", "r-a");
    expect(onConfirmed).toHaveBeenNthCalledWith(3, 4, "sig-bulk", "j-c", "r-c");
  });

  it("CONFIRMED: tolerates the legacy single-job record shape", async () => {
    const { ctx, onConfirmed } = fakeCtx();

    const out = await applyOutcome(ctx, record({ unit: 9, job: "old-job", run: "old-run" }), {
      result: "CONFIRMED",
      signature: "sig-old",
    });

    expect(out).toEqual({ result: "CONFIRMED", signature: "sig-old", jobCount: 1 });
    expect(onConfirmed).toHaveBeenCalledWith(9, "sig-old", "old-job", "old-run");
  });

  it("ERROR: marks SENT and runs onError", async () => {
    const { ctx, onError } = fakeCtx();

    await applyOutcome(ctx, record({ unit: 2 }), { result: "ERROR", error: "boom", signature: "sig-err" });

    expect(onError).toHaveBeenCalledWith(2, "boom", "sig-err");
  });

  it("EXPIRED: marks SENT, no handler fired", async () => {
    const { ctx, updateOne, onConfirmed, onError } = fakeCtx();

    await applyOutcome(ctx, record(), { result: "EXPIRED" });

    expect(updateOne).toHaveBeenCalledOnce();
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("ABORTED: no write, no handler", async () => {
    const { ctx, updateOne, onConfirmed, onError } = fakeCtx();

    await applyOutcome(ctx, record(), { result: "ABORTED" });

    expect(updateOne).not.toHaveBeenCalled();
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
