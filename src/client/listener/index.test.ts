import { describe, it, expect, vi } from "vitest";

import { createCollectionListener, RESUME_TOKENS_COLLECTION, RESUME_TOKEN_SAVE_INTERVAL_MS } from "./index.js";

import type { Db } from "mongodb";

type StreamEvent = { value: unknown; done: boolean; err?: unknown };

type FakeStream = {
  closed: boolean;
  close: () => Promise<void>;
  push: (event: unknown) => void;
  end: () => void;
  fail: (err: unknown) => void;
  [Symbol.asyncIterator]: () => AsyncIterator<unknown>;
};

function createFakeStream(): FakeStream {
  const queue: StreamEvent[] = [];
  const waiters: Array<(v: StreamEvent) => void> = [];

  const dispatch = (item: StreamEvent) => {
    const waiter = waiters.shift();
    if (waiter) waiter(item);
    else queue.push(item);
  };

  const stream: FakeStream = {
    closed: false,
    close: async () => {
      stream.closed = true;
      dispatch({ value: undefined, done: true });
    },
    push: (event) => dispatch({ value: event, done: false }),
    end: () => dispatch({ value: undefined, done: true }),
    fail: (err) => dispatch({ value: undefined, done: true, err }),
    [Symbol.asyncIterator]() {
      return {
        next: () =>
          new Promise<IteratorResult<unknown>>((resolve, reject) => {
            const handle = (item: StreamEvent) => {
              if (item.err) reject(item.err);
              else resolve({ value: item.value, done: item.done });
            };
            const queued = queue.shift();
            if (queued) handle(queued);
            else waiters.push(handle);
          }),
      };
    },
  };

  return stream;
}

/** The resume-token checkpoints: none saved unless a test says otherwise. */
function createFakeCheckpoints(initial?: unknown) {
  const saved = { token: initial };
  return {
    findOne: vi.fn(async () => (saved.token === undefined ? null : { _id: "deployments", token: saved.token })),
    updateOne: vi.fn(async () => ({ acknowledged: true })),
    deleteOne: vi.fn(async () => {
      saved.token = undefined;
      return { acknowledged: true };
    }),
  };
}

function createFakeDb(
  stream: FakeStream,
  checkpoints = createFakeCheckpoints(),
  watch = vi.fn<(...args: unknown[]) => FakeStream>(() => stream)
): Db {
  return {
    collection: (name: string) => (name === RESUME_TOKENS_COLLECTION ? checkpoints : { watch }),
  } as unknown as Db;
}

async function flush(): Promise<void> {
  await new Promise((r) => setImmediate(r));
}

describe("createCollectionListener", () => {
  it("delivers insert events to all registered insert listeners", async () => {
    const stream = createFakeStream();
    const db = createFakeDb(stream);

    const onInsertA = vi.fn();
    const onInsertB = vi.fn();
    const listener = createCollectionListener("deployments", db);
    listener.addListener("insert", onInsertA);
    listener.addListener("insert", onInsertB);

    const started = listener.start();

    stream.push({ operationType: "insert", fullDocument: { _id: "a" } });
    stream.push({ operationType: "insert", fullDocument: { _id: "b" } });
    await flush();

    expect(onInsertA).toHaveBeenCalledTimes(2);
    expect(onInsertB).toHaveBeenCalledTimes(2);
    expect(onInsertA).toHaveBeenNthCalledWith(1, { _id: "a" }, db);

    await listener.stop();
    await started;
  });

  it("delivers update events when no filter options are set", async () => {
    const stream = createFakeStream();
    const db = createFakeDb(stream);

    const onUpdate = vi.fn();
    const listener = createCollectionListener("deployments", db);
    listener.addListener("update", onUpdate);

    const started = listener.start();
    stream.push({
      operationType: "update",
      updateDescription: { updatedFields: { status: "RUNNING" } },
      fullDocument: { _id: "x", status: "RUNNING" },
    });
    await flush();

    expect(onUpdate).toHaveBeenCalledWith({ _id: "x", status: "RUNNING" }, db);

    await listener.stop();
    await started;
  });

  it("skips update events whose updatedFields are missing", async () => {
    const stream = createFakeStream();
    const db = createFakeDb(stream);

    const onUpdate = vi.fn();
    const listener = createCollectionListener("deployments", db);
    listener.addListener("update", onUpdate);

    const started = listener.start();
    stream.push({
      operationType: "update",
      updateDescription: {},
      fullDocument: { _id: "x" },
    });
    await flush();

    expect(onUpdate).not.toHaveBeenCalled();

    await listener.stop();
    await started;
  });

  it("respects the `fields` option and skips updates that do not touch any matching field", async () => {
    const stream = createFakeStream();
    const db = createFakeDb(stream);

    const onUpdate = vi.fn();
    const listener = createCollectionListener("deployments", db);
    listener.addListener("update", onUpdate, { fields: ["status"] });

    const started = listener.start();

    stream.push({
      operationType: "update",
      updateDescription: { updatedFields: { revision: 2 } },
      fullDocument: { _id: "x", revision: 2 },
    });
    await flush();
    expect(onUpdate).not.toHaveBeenCalled();

    stream.push({
      operationType: "update",
      updateDescription: { updatedFields: { status: "STOPPING" } },
      fullDocument: { _id: "x", status: "STOPPING" },
    });
    await flush();
    expect(onUpdate).toHaveBeenCalledWith({ _id: "x", status: "STOPPING" }, db);

    await listener.stop();
    await started;
  });

  it("respects the `filters` option and skips updates whose values do not match", async () => {
    const stream = createFakeStream();
    const db = createFakeDb(stream);

    const onUpdate = vi.fn();
    const listener = createCollectionListener("deployments", db);
    listener.addListener("update", onUpdate, {
      filters: { status: { $eq: "RUNNING" } },
    });

    const started = listener.start();

    stream.push({
      operationType: "update",
      updateDescription: { updatedFields: { status: "STOPPING" } },
      fullDocument: { _id: "x", status: "STOPPING" },
    });
    await flush();
    expect(onUpdate).not.toHaveBeenCalled();

    stream.push({
      operationType: "update",
      updateDescription: { updatedFields: { status: "RUNNING" } },
      fullDocument: { _id: "x", status: "RUNNING" },
    });
    await flush();
    expect(onUpdate).toHaveBeenCalledWith({ _id: "x", status: "RUNNING" }, db);

    await listener.stop();
    await started;
  });

  it("matches `filters` against the full document, not just the changed fields", async () => {
    const stream = createFakeStream();
    const db = createFakeDb(stream);

    const onUpdate = vi.fn();
    const listener = createCollectionListener("deployments", db);
    listener.addListener("update", onUpdate, {
      fields: ["replicas"],
      filters: { strategy: { $in: ["SIMPLE", "SIMPLE-EXTEND"] } },
    });

    const started = listener.start();

    // A SCHEDULED deployment changing replicas: `strategy` is not in the delta,
    // so the filter must read it from the full document to exclude it.
    stream.push({
      operationType: "update",
      updateDescription: { updatedFields: { replicas: 4 } },
      fullDocument: { _id: "x", strategy: "SCHEDULED", replicas: 4 },
    });
    await flush();
    expect(onUpdate).not.toHaveBeenCalled();

    // A SIMPLE deployment changing replicas: the filter still must match using
    // the full document's `strategy`.
    stream.push({
      operationType: "update",
      updateDescription: { updatedFields: { replicas: 4 } },
      fullDocument: { _id: "x", strategy: "SIMPLE", replicas: 4 },
    });
    await flush();
    expect(onUpdate).toHaveBeenCalledWith(
      { _id: "x", strategy: "SIMPLE", replicas: 4 },
      db,
    );

    await listener.stop();
    await started;
  });

  it("skips update events without a fullDocument", async () => {
    const stream = createFakeStream();
    const db = createFakeDb(stream);

    const onUpdate = vi.fn();
    const listener = createCollectionListener("deployments", db);
    listener.addListener("update", onUpdate);

    const started = listener.start();
    stream.push({
      operationType: "update",
      updateDescription: { updatedFields: { status: "RUNNING" } },
      fullDocument: undefined,
    });
    await flush();

    expect(onUpdate).not.toHaveBeenCalled();

    await listener.stop();
    await started;
  });

  it("delivers delete events with the document key", async () => {
    const stream = createFakeStream();
    const db = createFakeDb(stream);

    const onDelete = vi.fn();
    const listener = createCollectionListener("tasks", db);
    listener.addListener("delete", onDelete);

    const started = listener.start();
    stream.push({ operationType: "delete", documentKey: { _id: "x" } });
    await flush();

    expect(onDelete).toHaveBeenCalledWith({ _id: "x" }, db);

    await listener.stop();
    await started;
  });

  it("ignores stream errors raised after stop()", async () => {
    const stream = createFakeStream();
    const db = createFakeDb(stream);

    const listener = createCollectionListener("deployments", db);
    listener.addListener("insert", vi.fn());

    const started = listener.start();
    await listener.stop();
    stream.fail(new Error("post-close error"));

    await expect(started).resolves.toBeUndefined();
    expect(stream.closed).toBe(true);
  });

  it("propagates stream errors raised before stop()", async () => {
    const stream = createFakeStream();
    const db = createFakeDb(stream);

    const listener = createCollectionListener("deployments", db);
    listener.addListener("insert", vi.fn());

    const started = listener.start();
    stream.fail(new Error("upstream failure"));

    await expect(started).rejects.toThrow("upstream failure");
  });

  it("keeps running when a callback fails, so a failing event can never crash-loop a resumed stream", async () => {
    const stream = createFakeStream();
    const db = createFakeDb(stream);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const after = vi.fn();
    const listener = createCollectionListener("deployments", db);
    listener.addListener("insert", async () => {
      throw new Error("callback failure");
    });
    listener.addListener("insert", () => {
      throw new Error("sync failure");
    });
    listener.addListener("insert", after);

    const started = listener.start();
    stream.push({ operationType: "insert", fullDocument: { _id: "a" } });
    stream.push({ operationType: "insert", fullDocument: { _id: "b" } });
    await flush();

    expect(after).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith("[listener] a deployments callback failed", expect.any(Error));

    await listener.stop();
    await started;
    error.mockRestore();
  });

  describe("resume tokens", () => {
    // The fake stream exposes the driver's `resumeToken`: the position delivered so far.
    const withToken = (stream: FakeStream, token: unknown) => Object.assign(stream, { resumeToken: token });

    it("resumes after the checkpointed position", async () => {
      const stream = createFakeStream();
      const watch = vi.fn<(...args: unknown[]) => FakeStream>(() => stream);
      const db = createFakeDb(stream, createFakeCheckpoints({ _data: "t1" }), watch);

      const listener = createCollectionListener("deployments", db);
      const started = listener.start();
      await flush();

      expect(watch).toHaveBeenCalledWith([], { fullDocument: "updateLookup", resumeAfter: { _data: "t1" } });

      await listener.stop();
      await started;
    });

    it("starts from now when there is no checkpoint", async () => {
      const stream = createFakeStream();
      const watch = vi.fn<(...args: unknown[]) => FakeStream>(() => stream);
      const db = createFakeDb(stream, createFakeCheckpoints(), watch);

      const listener = createCollectionListener("deployments", db);
      const started = listener.start();
      await flush();

      expect(watch).toHaveBeenCalledWith([], { fullDocument: "updateLookup" });

      await listener.stop();
      await started;
    });

    it("checkpoints the delivered position on an interval and on stop, only when it moved", async () => {
      vi.useFakeTimers();
      const stream = withToken(createFakeStream(), { _data: "t2" });
      const checkpoints = createFakeCheckpoints();
      const db = createFakeDb(stream, checkpoints);

      const listener = createCollectionListener("deployments", db);
      const started = listener.start();
      await vi.advanceTimersByTimeAsync(RESUME_TOKEN_SAVE_INTERVAL_MS);

      expect(checkpoints.updateOne).toHaveBeenCalledExactlyOnceWith(
        { _id: "deployments" },
        { $set: { token: { _data: "t2" }, updated_at: expect.any(Date) } },
        { upsert: true }
      );

      await vi.advanceTimersByTimeAsync(RESUME_TOKEN_SAVE_INTERVAL_MS);
      expect(checkpoints.updateOne).toHaveBeenCalledOnce(); // nothing new delivered

      withToken(stream, { _data: "t3" });
      await listener.stop();
      await started;
      expect(checkpoints.updateOne).toHaveBeenLastCalledWith(
        { _id: "deployments" },
        { $set: { token: { _data: "t3" }, updated_at: expect.any(Date) } },
        { upsert: true }
      );
      vi.useRealTimers();
    });

    it("starts from now, dropping the checkpoint, when the stream can no longer resume from it", async () => {
      const stale = createFakeStream();
      const fresh = createFakeStream();
      const watch = vi.fn().mockReturnValueOnce(stale).mockReturnValueOnce(fresh);
      const checkpoints = createFakeCheckpoints({ _data: "expired" });
      const db = createFakeDb(fresh, checkpoints, watch);
      const error = vi.spyOn(console, "error").mockImplementation(() => {});

      const onInsert = vi.fn();
      const listener = createCollectionListener("deployments", db);
      listener.addListener("insert", onInsert);
      const started = listener.start();
      stale.fail(Object.assign(new Error("resume point may no longer be in the oplog"), { code: 286 }));
      await flush();

      expect(checkpoints.deleteOne).toHaveBeenCalledWith({ _id: "deployments" });
      expect(watch).toHaveBeenLastCalledWith([], { fullDocument: "updateLookup" });

      fresh.push({ operationType: "insert", fullDocument: { _id: "a" } });
      await flush();
      expect(onInsert).toHaveBeenCalledOnce();

      await listener.stop();
      await expect(started).resolves.toBeUndefined();
      error.mockRestore();
    });

    it("still fails on an error after events were delivered", async () => {
      const stream = createFakeStream();
      const db = createFakeDb(stream, createFakeCheckpoints({ _data: "t1" }));

      const listener = createCollectionListener("deployments", db);
      listener.addListener("insert", vi.fn());
      const started = listener.start();
      stream.push({ operationType: "insert", fullDocument: { _id: "a" } });
      await flush();
      stream.fail(new Error("upstream failure"));

      await expect(started).rejects.toThrow("upstream failure");
    });
  });

  it("rejects construction with an invalid collection name", () => {
    const stream = createFakeStream();
    const db = createFakeDb(stream);

    expect(() =>
      // @ts-expect-error intentionally invalid for this test
      createCollectionListener("not-a-collection", db),
    ).toThrow("Invalid collection.");
  });

  it("is a no-op when stop() is called before start()", async () => {
    const stream = createFakeStream();
    const db = createFakeDb(stream);

    const listener = createCollectionListener("deployments", db);
    await listener.stop();

    expect(stream.closed).toBe(false);
  });

  it("does not start the stream after stop() has been called", async () => {
    const stream = createFakeStream();
    const db = createFakeDb(stream);

    const listener = createCollectionListener("deployments", db);
    await listener.stop();
    await listener.start();

    expect(stream.closed).toBe(false);
  });
});
