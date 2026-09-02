import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

import { streamDeploymentEventsHandler } from "./streamDeploymentEvents.js";
import { createDeploymentWatchers, type DeploymentStreamEvent } from "../../../../stream/deploymentWatchers.js";

const DEPLOYMENT_ID = "9X4SgG88q7La2UAxioNJKD9EfYEMtYpnuLHvzUvEGDEB";
type TestEndpoint = { opId: string; port: number; url: string; online: boolean };
const DEPLOYMENT = { id: DEPLOYMENT_ID, status: "STARTING", replicas: 1, active_revision: 1, endpoints: [] as TestEndpoint[] };
const DEPLOYMENT_EVENT = { type: "deployment", status: "STARTING", replicas: 1, active_revision: 1 };
const EXISTING_JOB = { deployment: DEPLOYMENT_ID, job: "existing", state: "QUEUED", node: null, time_start: 0, revision: 3, created_at: new Date("2026-08-22T10:00:00.000Z") };
const OUTSTANDING_TASK = { _id: "task-1", deploymentId: DEPLOYMENT_ID, task: "STOP", status: "PENDING", attempts: 0, due_at: new Date("2026-08-22T10:05:00.000Z"), job: "existing" };
const PLUGIN_HEADERS = { "access-control-allow-origin": "https://dashboard.example", vary: "Origin" };

const jobEvent = (overrides: Partial<Extract<DeploymentStreamEvent, { type: "job" }>> = {}): DeploymentStreamEvent =>
  ({ type: "job", job: "j", state: "RUNNING", node: "n", timeStart: 5, timeEnd: 0, revision: 1, created_at: "2026-08-22T10:00:00.000Z", ...overrides });

const harness = ({
  activeJobs = [] as unknown[],
  outstandingTasks = [] as unknown[],
  endpoints = [] as TestEndpoint[],
} = {}) => {
  const raw = new EventEmitter() as EventEmitter & {
    setHeader: ReturnType<typeof vi.fn>;
    writeHead: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    writableEnded: boolean;
    destroyed: boolean;
  };
  raw.setHeader = vi.fn();
  raw.writeHead = vi.fn();
  raw.write = vi.fn();
  raw.end = vi.fn(() => { raw.writableEnded = true; });
  raw.writableEnded = false;
  raw.destroyed = false;

  const toArray = vi.fn().mockResolvedValue(activeJobs);
  const sort = vi.fn(() => ({ toArray }));
  const find = vi.fn(() => ({ sort }));
  const tasksToArray = vi.fn().mockResolvedValue(outstandingTasks);
  const tasksSort = vi.fn(() => ({ toArray: tasksToArray }));
  const tasksFind = vi.fn(() => ({ sort: tasksSort }));
  const watchers = createDeploymentWatchers();

  const req = { params: { deployment: DEPLOYMENT_ID }, log: { error: vi.fn() } };
  const res = {
    raw,
    hijack: vi.fn(),
    status: vi.fn().mockReturnThis(),
    send: vi.fn(),
    getHeaders: vi.fn(() => PLUGIN_HEADERS),
    locals: {
      deployment: { ...DEPLOYMENT, endpoints },
      db: { jobs: { find }, tasks: { find: tasksFind } },
      deploymentWatchers: watchers,
    },
  };

  return {
    req,
    res,
    watchers,
    find,
    sort,
    toArray,
    tasksFind,
    tasksSort,
    open: () => streamDeploymentEventsHandler(req as never, res as never),
  };
};

/** Payloads of the data: frames written so far. */
const frames = (write: ReturnType<typeof vi.fn>) =>
  write.mock.calls
    .map(([chunk]) => String(chunk))
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice("data: ".length)));

describe("streamDeploymentEventsHandler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("closes the snapshot with every endpoint, reachable or not", async () => {
    const api = { opId: "api", port: 8080, url: "https://api.test", online: true };
    const ui = { opId: "ui", port: 3000, url: "https://ui.test", online: false };
    const { res, open } = harness({ endpoints: [api, ui] });

    await open();

    expect(frames(res.raw.write)).toEqual([
      DEPLOYMENT_EVENT,
      // The active-job set, empty here, still states the snapshot so a
      // reconnecting client prunes anything it was still showing.
      { type: "jobs", jobs: [] },
      // The endpoint itself, url included — the client needs nothing else to
      // render it.
      { type: "endpoint", ...api },
      // The live frames that follow are sent only on a change, so an endpoint
      // that has never come up still has to be stated once.
      { type: "endpoint", ...ui },
    ]);
  });

  it("states each port of an op separately, since each is a row the client shows", async () => {
    const first = { opId: "api", port: 8080, url: "https://api.test", online: true };
    const second = { opId: "api", port: 9090, url: "https://api.test", online: true };
    const { res, open } = harness({ endpoints: [first, second] });

    await open();

    expect(frames(res.raw.write).filter((frame) => frame.type === "endpoint")).toEqual([
      { type: "endpoint", ...first },
      { type: "endpoint", ...second },
    ]);
  });

  it("opens an event-stream that proxies must not buffer, keeping the headers plugins set", async () => {
    const { res, open } = harness();
    await open();

    expect(res.hijack).toHaveBeenCalled();
    expect(res.raw.setHeader).toHaveBeenCalledWith("access-control-allow-origin", PLUGIN_HEADERS["access-control-allow-origin"]);
    expect(res.raw.setHeader).toHaveBeenCalledWith("vary", PLUGIN_HEADERS.vary);
    expect(res.raw.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no",
    }));
  });

  it("sends the deployment, its active jobs and outstanding tasks first, then pushes changes", async () => {
    const { res, find, sort, tasksFind, tasksSort, watchers, open } = harness({
      activeJobs: [EXISTING_JOB],
      outstandingTasks: [OUTSTANDING_TASK],
    });
    await open();

    expect(find).toHaveBeenCalledWith({ deployment: DEPLOYMENT_ID, state: { $in: ["QUEUED", "RUNNING"] } });
    expect(sort).toHaveBeenCalledWith({ created_at: 1 });
    expect(tasksFind).toHaveBeenCalledWith({ deploymentId: DEPLOYMENT_ID });
    expect(tasksSort).toHaveBeenCalledWith({ due_at: 1 });
    expect(frames(res.raw.write)).toEqual([
      DEPLOYMENT_EVENT,
      // The authoritative active-job set, ahead of the per-job detail.
      { type: "jobs", jobs: ["existing"] },
      { type: "job", job: "existing", state: "QUEUED", node: null, timeStart: 0, timeEnd: 0, revision: 3, created_at: "2026-08-22T10:00:00.000Z" },
      { type: "task", id: "task-1", task: "STOP", status: "PENDING", attempts: 0, due_at: "2026-08-22T10:05:00.000Z", job: "existing" },
    ]);
    // The snapshot's tasks are remembered so their deletions route back here.
    expect(watchers.untrackTask("task-1")).toEqual({ deploymentId: DEPLOYMENT_ID, task: "STOP" });

    watchers.notify(DEPLOYMENT_ID, jobEvent({ job: "live" }));

    expect(frames(res.raw.write)[4]).toEqual(jobEvent({ job: "live" }));
  });

  it("answers 503 instead of opening a stream when the active jobs cannot be loaded", async () => {
    const { req, res, watchers, toArray, open } = harness();
    toArray.mockRejectedValue(new Error("jobs unavailable"));

    await open();

    expect(req.log.error).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.send).toHaveBeenCalledWith({ error: expect.any(String) });
    expect(res.hijack).not.toHaveBeenCalled();
    expect(res.raw.writeHead).not.toHaveBeenCalled();
    expect(watchers.count(DEPLOYMENT_ID)).toBe(0);
  });

  it("does not open a stream when the client left during the lookups", async () => {
    const { res, watchers, open } = harness();
    // The socket closed while the middleware and jobs lookups ran.
    res.raw.destroyed = true;

    await open();

    expect(res.raw.writeHead).not.toHaveBeenCalled();
    expect(res.raw.write).not.toHaveBeenCalled();
    expect(watchers.count(DEPLOYMENT_ID)).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(res.raw.write).not.toHaveBeenCalled();
  });

  it("keeps the connection alive while it is open", async () => {
    const { res, open } = harness();
    await open();

    vi.advanceTimersByTime(25_000);

    expect(res.raw.write).toHaveBeenCalledWith(": keep-alive\n\n");
  });

  it("unwatches and stops the heartbeat when the client disconnects", async () => {
    const { res, watchers, open } = harness();
    await open();
    expect(watchers.count(DEPLOYMENT_ID)).toBe(1);

    res.raw.emit("close");

    expect(watchers.count(DEPLOYMENT_ID)).toBe(0);
    const writesBefore = res.raw.write.mock.calls.length;
    vi.advanceTimersByTime(60_000);
    expect(res.raw.write.mock.calls).toHaveLength(writesBefore);
  });

  it("does not write to a response that already ended", async () => {
    const { res, watchers, open } = harness();
    await open();
    const writesBefore = res.raw.write.mock.calls.length;
    res.raw.writableEnded = true;

    watchers.notify(DEPLOYMENT_ID, jobEvent({ job: "late", state: "COMPLETED", timeEnd: 1 }));
    vi.advanceTimersByTime(25_000);

    expect(res.raw.write.mock.calls).toHaveLength(writesBefore);
  });

  it("ends open streams when the server shuts down", async () => {
    const { res, watchers, open } = harness();
    await open();

    watchers.closeAll();

    expect(res.raw.end).toHaveBeenCalled();
    expect(watchers.count(DEPLOYMENT_ID)).toBe(0);
    const writesBefore = res.raw.write.mock.calls.length;
    vi.advanceTimersByTime(60_000);
    expect(res.raw.write.mock.calls).toHaveLength(writesBefore);
  });
});
