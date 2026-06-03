import { describe, it, expect, vi } from "vitest";

import { createCollectionListener } from "./index.js";

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

function createFakeDb(stream: FakeStream): Db {
  const watch = vi.fn(() => stream);
  return { collection: () => ({ watch }) } as unknown as Db;
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
