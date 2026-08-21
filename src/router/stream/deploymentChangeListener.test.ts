import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { JobState, type DeploymentDocument, type EventDocument, type JobsDocument } from "../../types/index.js";

type Callback = (doc: unknown, db: unknown) => void;
type Collection = "deployments" | "jobs" | "events" | "tasks";
type Stream = {
  insert: Callback[];
  update: Callback[];
  delete: Callback[];
  updateOptions: unknown[];
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  /** The change stream errors out. */
  fail: (error: Error) => void;
  /** The change stream ends on its own. */
  end: () => void;
};

/** Every collection listener opened so far, per collection, oldest first. */
const opened: Record<Collection, Stream[]> = { deployments: [], jobs: [], events: [], tasks: [] };

vi.mock("../../client/listener/index.js", () => ({
  createCollectionListener: (key: Collection) => {
    let settle!: { resolve: () => void; reject: (error: Error) => void };
    const running = new Promise<void>((resolve, reject) => { settle = { resolve, reject }; });
    const stream: Stream = {
      insert: [],
      update: [],
      delete: [],
      updateOptions: [],
      start: vi.fn(() => running),
      // Closing the cursor ends the run, as it does for the real listener.
      stop: vi.fn(async () => settle.resolve()),
      fail: (error) => settle.reject(error),
      end: () => settle.resolve(),
    };
    opened[key].push(stream);
    return {
      addListener: (event: "insert" | "update" | "delete", callback: Callback, options?: unknown) => {
        stream[event].push(callback);
        if (options) stream.updateOptions.push(options);
      },
      start: stream.start,
      stop: stream.stop,
    };
  },
}));

const { startDeploymentChangeListener, REOPEN_DELAY_MS } = await import("./deploymentChangeListener.js");
const { createDeploymentWatchers } = await import("./deploymentWatchers.js");

const DEPLOYMENT = "9X4SgG88q7La2UAxioNJKD9EfYEMtYpnuLHvzUvEGDEB";
const OTHER_DEPLOYMENT = "FQNZjQxwwTayqUVPxZDRMx7FPzCurx1n2musBfH4LJbQ";
const JOB = "Bv6sYZDFj2vVFkWV9EoiQBiEjLGswxtDZMdLDZ5fLPYp";
const NODE = "HS7ZbbBYbLVSs1gUA5vEQQF6oLWSKus3wri2QiYjdUjW";
const COLLECTIONS: Collection[] = ["deployments", "jobs", "events", "tasks"];

const latest = (collection: Collection) => opened[collection].at(-1)!;
const emit = (collection: Collection, event: "insert" | "update" | "delete", doc: unknown) =>
  latest(collection)[event].forEach((callback) => callback(doc, {}));

const job = (overrides: Partial<JobsDocument> = {}): JobsDocument =>
  ({ deployment: DEPLOYMENT, job: JOB, state: JobState.RUNNING, node: NODE, time_start: 1787291204, ...overrides }) as JobsDocument;

const deployment = (overrides: Partial<DeploymentDocument> = {}): DeploymentDocument =>
  ({ id: DEPLOYMENT, status: "RUNNING", replicas: 2, active_revision: 3, ...overrides }) as DeploymentDocument;

const logEntry = (overrides: Partial<EventDocument> = {}): EventDocument => ({
  category: "Deployment",
  deploymentId: DEPLOYMENT,
  type: "DEPLOYMENT_STARTED",
  message: "Deployment started",
  tx: "sig",
  created_at: new Date("2026-08-22T10:00:00.000Z"),
  ...overrides,
});

const task = (overrides: Record<string, unknown> = {}) => ({
  _id: "task-1",
  deploymentId: DEPLOYMENT,
  task: "STOP",
  status: "PENDING",
  attempts: 0,
  due_at: new Date("2026-08-22T10:05:00.000Z"),
  job: JOB,
  ...overrides,
});

describe("startDeploymentChangeListener", () => {
  let watchers: ReturnType<typeof createDeploymentWatchers>;
  let handle: ReturnType<typeof startDeploymentChangeListener>;
  let log: { error: ReturnType<typeof vi.fn> };
  let received: unknown[];

  const watch = (id = DEPLOYMENT) => watchers.watch(id, { send: (event) => received.push(event), close: vi.fn() });

  beforeEach(() => {
    vi.useFakeTimers();
    COLLECTIONS.forEach((collection) => { opened[collection] = []; });
    received = [];
    log = { error: vi.fn() };
    watchers = createDeploymentWatchers();
    handle = startDeploymentChangeListener({} as never, watchers, log);
  });

  afterEach(async () => {
    await handle.stop();
    vi.useRealTimers();
  });

  it("starts watching deployments, jobs, the event log and tasks", () => {
    COLLECTIONS.forEach((collection) => expect(latest(collection).start).toHaveBeenCalled());
  });

  it("forwards updates only to the fields the stream reports", () => {
    expect(latest("deployments").updateOptions).toEqual([{ fields: ["status", "replicas", "active_revision"] }]);
    expect(latest("jobs").updateOptions).toEqual([{ fields: ["state", "node", "time_start", "time_end"] }]);
    expect(latest("tasks").updateOptions).toEqual([{ fields: ["status", "attempts", "due_at"] }]);
    // The event log is append-only.
    expect(latest("events").update).toHaveLength(0);
  });

  it("sends a job change to the connections watching its deployment", () => {
    watch();

    emit("jobs", "update", job());

    expect(received).toEqual([
      { type: "job", job: JOB, state: JobState.RUNNING, node: NODE, timeStart: 1787291204, timeEnd: 0 },
    ]);
  });

  it("sends a deployment change on insert and update alike", () => {
    watch();

    emit("deployments", "insert", deployment());
    emit("deployments", "update", deployment({ replicas: 3 }));

    expect(received).toEqual([
      { type: "deployment", status: "RUNNING", replicas: 2, active_revision: 3 },
      { type: "deployment", status: "RUNNING", replicas: 3, active_revision: 3 },
    ]);
  });

  it("sends a new event-log entry to the connections watching its deployment", () => {
    watch();

    emit("events", "insert", logEntry());

    expect(received).toEqual([{
      type: "event",
      category: "Deployment",
      event: "DEPLOYMENT_STARTED",
      message: "Deployment started",
      tx: "sig",
      created_at: "2026-08-22T10:00:00.000Z",
    }]);
  });

  it("follows a task from queued to done", () => {
    watch();

    emit("tasks", "insert", task());
    emit("tasks", "update", task({ status: "PROCESSING", attempts: 1 }));
    emit("tasks", "delete", { _id: "task-1" });

    expect(received).toEqual([
      { type: "task", id: "task-1", task: "STOP", status: "PENDING", attempts: 0, due_at: "2026-08-22T10:05:00.000Z", job: JOB },
      { type: "task", id: "task-1", task: "STOP", status: "PROCESSING", attempts: 1, due_at: "2026-08-22T10:05:00.000Z", job: JOB },
      { type: "task", id: "task-1", task: "STOP", status: "DONE" },
    ]);
  });

  it("reports done for a task the connect snapshot registered, and only once", () => {
    watch();
    watchers.trackTask("task-2", DEPLOYMENT, "LIST");

    emit("tasks", "delete", { _id: "task-2" });
    emit("tasks", "delete", { _id: "task-2" });

    expect(received).toEqual([{ type: "task", id: "task-2", task: "LIST", status: "DONE" }]);
  });

  it("ignores deletions of tasks it never saw", () => {
    watch();

    expect(() => emit("tasks", "delete", { _id: "unknown" })).not.toThrow();
    expect(received).toHaveLength(0);
  });

  it("fans one change out to every connection on the same deployment", () => {
    const second: unknown[] = [];
    watch();
    watchers.watch(DEPLOYMENT, { send: (event) => second.push(event), close: vi.fn() });

    emit("deployments", "update", deployment());

    expect(received).toHaveLength(1);
    expect(second).toEqual(received);
  });

  it("drops changes to deployments nobody is watching", () => {
    watch();

    emit("jobs", "update", job({ deployment: OTHER_DEPLOYMENT }));
    emit("deployments", "update", deployment({ id: OTHER_DEPLOYMENT }));
    emit("events", "insert", logEntry({ deploymentId: OTHER_DEPLOYMENT }));
    emit("tasks", "insert", task({ deploymentId: OTHER_DEPLOYMENT }));
    emit("tasks", "delete", { _id: "task-1" });

    expect(received).toHaveLength(0);
  });

  it("stops sending once the connection unwatches", () => {
    const unwatch = watch();

    unwatch();
    emit("jobs", "update", job());

    expect(received).toHaveLength(0);
  });

  it.each([
    ["fails", (stream: Stream) => stream.fail(new Error("cursor invalidated"))],
    ["ends on its own", (stream: Stream) => stream.end()],
  ])("reopens every stream when one %s, and keeps the process up", async (_case, breakStream) => {
    const close = vi.fn();
    const unwatch = watchers.watch(DEPLOYMENT, { send: (event) => received.push(event), close });
    close.mockImplementation(unwatch);
    const first = Object.fromEntries(COLLECTIONS.map((collection) => [collection, opened[collection][0]!])) as Record<Collection, Stream>;

    breakStream(first.events);
    await vi.advanceTimersByTimeAsync(1);

    expect(log.error).toHaveBeenCalledOnce();
    COLLECTIONS.forEach((collection) => expect(first[collection].stop).toHaveBeenCalled());
    expect(opened.events).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(REOPEN_DELAY_MS);

    COLLECTIONS.forEach((collection) => {
      expect(opened[collection]).toHaveLength(2);
      expect(latest(collection).start).toHaveBeenCalled();
    });
    expect(close).toHaveBeenCalledOnce();
    // Closing the siblings ourselves is not a second failure.
    expect(log.error).toHaveBeenCalledOnce();

    watch();
    emit("jobs", "update", job());
    expect(received).toHaveLength(1);
  });

  it("does not reopen after stop()", async () => {
    await handle.stop();

    COLLECTIONS.forEach((collection) => expect(latest(collection).stop).toHaveBeenCalled());

    await vi.advanceTimersByTimeAsync(REOPEN_DELAY_MS * 2);

    expect(opened.deployments).toHaveLength(1);
    expect(log.error).not.toHaveBeenCalled();
  });
});
