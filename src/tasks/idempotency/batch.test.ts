import { describe, it, expect, vi } from "vitest";

import { runIdempotentBatch, type BatchResponseItem } from "./batch.js";
import { IdempotencyCode } from "./classify.js";

const coded = (code: string, statusCode = 409) => Object.assign(new Error(code), { code, statusCode });

/** Build the list of units from plain ids; the body just echoes the id. */
const unitsOf = (...ids: number[]) => ids.map((id) => ({ id, body: { n: id } }));

/** A resolved response from a status-by-index map. */
const resolved = (
  items: Array<{ status: "confirmed" | "expired"; tx?: string }>
): { items: BatchResponseItem[] } => ({
  items: items.map((item, index) => ({ index, ...item })),
});

describe("runIdempotentBatch", () => {
  it("all confirmed at epoch 0 -> ok, carries each tx, posts the full set once under :0", async () => {
    const post = vi.fn().mockResolvedValue(
      resolved([
        { status: "confirmed", tx: "txA" },
        { status: "confirmed", tx: "txB" },
      ])
    );

    const result = await runIdempotentBatch({
      taskId: "t",
      op: "list",
      maxEpoch: 3,
      units: unitsOf(0, 1),
      post,
    });

    expect(result).toEqual({
      kind: "ok",
      confirmed: [
        { id: 0, tx: "txA", job: undefined, run: undefined },
        { id: 1, tx: "txB", job: undefined, run: undefined },
      ],
    });
    expect(post).toHaveBeenCalledExactlyOnceWith([{ n: 0 }, { n: 1 }], "t:list:0");
  });

  it("empty set is a no-op ok and never posts", async () => {
    const post = vi.fn();
    const result = await runIdempotentBatch({ taskId: "t", op: "list", maxEpoch: 3, units: [], post });

    expect(result).toEqual({ kind: "ok", confirmed: [] });
    expect(post).not.toHaveBeenCalled();
  });

  it("bumps the epoch for expired items, and the next key carries ONLY the expired subset", async () => {
    const post = vi
      .fn()
      // epoch 0: slot 1 confirms, slots 0 and 2 expire
      .mockResolvedValueOnce(
        resolved([{ status: "expired" }, { status: "confirmed", tx: "txB" }, { status: "expired" }])
      )
      // epoch 1: the two carried-over slots both confirm
      .mockResolvedValueOnce(resolved([{ status: "confirmed", tx: "txA" }, { status: "confirmed", tx: "txC" }]));

    const result = await runIdempotentBatch({
      taskId: "t",
      op: "list",
      maxEpoch: 3,
      units: unitsOf(0, 1, 2),
      post,
    });

    // confirmed accumulates across epochs, ids mapped back through the subset
    expect(result.kind).toBe("ok");
    expect(result.confirmed.map((c) => ({ id: c.id, tx: c.tx }))).toEqual([
      { id: 1, tx: "txB" },
      { id: 0, tx: "txA" },
      { id: 2, tx: "txC" },
    ]);
    // epoch 0 sent the full set; epoch 1's fresh key sent ONLY the expired bodies,
    // never the already-confirmed slot 1 (the core "exclude confirmed" rule).
    expect(post).toHaveBeenNthCalledWith(1, [{ n: 0 }, { n: 1 }, { n: 2 }], "t:list:0");
    expect(post).toHaveBeenNthCalledWith(2, [{ n: 0 }, { n: 2 }], "t:list:1");
  });

  it("IN_PROGRESS -> retry the SAME key (no epoch bump), surfacing Retry-After", async () => {
    const post = vi.fn().mockRejectedValue(
      Object.assign(coded(IdempotencyCode.IN_PROGRESS), { retryAfter: 5 })
    );

    const result = await runIdempotentBatch({
      taskId: "t",
      op: "list",
      maxEpoch: 3,
      units: unitsOf(0, 1),
      post,
    });

    expect(result).toEqual({ kind: "retry", confirmed: [], retryAfterMs: 5000 });
    expect(post).toHaveBeenCalledOnce(); // did NOT bump to :1
    expect(post).toHaveBeenCalledWith([{ n: 0 }, { n: 1 }], "t:list:0");
  });

  it("IN_PROGRESS at a later epoch keeps the earlier epoch's confirmations", async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce(resolved([{ status: "confirmed", tx: "txA" }, { status: "expired" }]))
      .mockRejectedValueOnce(coded(IdempotencyCode.IN_PROGRESS));

    const result = await runIdempotentBatch({
      taskId: "t",
      op: "list",
      maxEpoch: 3,
      units: unitsOf(0, 1),
      post,
    });

    expect(result.kind).toBe("retry");
    expect(result.confirmed).toEqual([{ id: 0, tx: "txA", job: undefined, run: undefined }]);
    expect(post).toHaveBeenNthCalledWith(2, [{ n: 1 }], "t:list:1");
  });

  it("PAYLOAD_MISMATCH (and other coded 4xx) is fatal, carrying any partial confirms", async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce(resolved([{ status: "confirmed", tx: "txA" }, { status: "expired" }]))
      .mockRejectedValueOnce(coded(IdempotencyCode.PAYLOAD_MISMATCH));

    const result = await runIdempotentBatch({
      taskId: "t",
      op: "list",
      maxEpoch: 3,
      units: unitsOf(0, 1),
      post,
    });

    expect(result.kind).toBe("fatal");
    expect(result.confirmed).toEqual([{ id: 0, tx: "txA", job: undefined, run: undefined }]);
  });

  it("out-of-credits (uncoded 402) is fatal", async () => {
    const post = vi.fn().mockRejectedValue(Object.assign(new Error("no credits"), { statusCode: 402 }));
    const result = await runIdempotentBatch({ taskId: "t", op: "list", maxEpoch: 3, units: unitsOf(0), post });

    expect(result.kind).toBe("fatal");
  });

  it("5xx / network throw -> retry", async () => {
    const post = vi.fn().mockRejectedValue(new Error("socket hang up")); // no statusCode
    const result = await runIdempotentBatch({ taskId: "t", op: "stop", maxEpoch: 3, units: unitsOf(0), post });

    expect(result).toEqual({ kind: "retry", confirmed: [], retryAfterMs: undefined });
  });

  it("still-expired after the epoch budget degrades to retry, keeping confirms", async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce(resolved([{ status: "confirmed", tx: "txA" }, { status: "expired" }]))
      .mockResolvedValue(resolved([{ status: "expired" }])); // every later epoch keeps expiring

    const result = await runIdempotentBatch({
      taskId: "t",
      op: "extend",
      maxEpoch: 2,
      units: unitsOf(0, 1),
      post,
    });

    expect(result.kind).toBe("retry");
    expect(result.confirmed).toEqual([{ id: 0, tx: "txA", job: undefined, run: undefined }]);
    expect(post).toHaveBeenCalledTimes(3); // epochs 0, 1, 2
    expect(post).toHaveBeenLastCalledWith([{ n: 1 }], "t:extend:2");
  });

  it("a confirmed no-op (terminal job, no tx) is carried as a confirmation with undefined tx", async () => {
    const post = vi.fn().mockResolvedValue(
      resolved([{ status: "confirmed", tx: "txReal" }, { status: "confirmed" }])
    );

    const result = await runIdempotentBatch({
      taskId: "t",
      op: "stop",
      maxEpoch: 3,
      units: unitsOf(0, 1),
      post,
    });

    expect(result.kind).toBe("ok");
    expect(result.confirmed).toEqual([
      { id: 0, tx: "txReal", job: undefined, run: undefined },
      { id: 1, tx: undefined, job: undefined, run: undefined },
    ]);
  });
});
