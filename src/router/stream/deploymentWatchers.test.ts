import { describe, it, expect, vi } from "vitest";

import {
  createDeploymentWatchers,
  toDeploymentEvent,
  toJobEvent,
  toLogEvent,
  toTaskDoneEvent,
  toTaskEvent,
  type DeploymentStreamEvent,
} from "./deploymentWatchers.js";
import { JobState, type DeploymentDocument, type EventDocument, type JobsDocument, type TaskDocument } from "../../types/index.js";
import type { WithId } from "mongodb";

const DEPLOYMENT = "9X4SgG88q7La2UAxioNJKD9EfYEMtYpnuLHvzUvEGDEB";
const OTHER_DEPLOYMENT = "FQNZjQxwwTayqUVPxZDRMx7FPzCurx1n2musBfH4LJbQ";
const EVENT: DeploymentStreamEvent = { type: "deployment", status: "RUNNING", replicas: 2, active_revision: 3 };

const connection = () => ({ send: vi.fn(), close: vi.fn() });

describe("createDeploymentWatchers", () => {
  it("watches nothing until a connection registers", () => {
    const watchers = createDeploymentWatchers();

    expect(watchers.has(DEPLOYMENT)).toBe(false);
    expect(watchers.count(DEPLOYMENT)).toBe(0);
    expect(() => watchers.notify(DEPLOYMENT, EVENT)).not.toThrow();
  });

  it("notifies every connection of a deployment, and only that deployment's", () => {
    const watchers = createDeploymentWatchers();
    const first = connection();
    const second = connection();
    const elsewhere = connection();
    watchers.watch(DEPLOYMENT, first);
    watchers.watch(DEPLOYMENT, second);
    watchers.watch(OTHER_DEPLOYMENT, elsewhere);

    watchers.notify(DEPLOYMENT, EVENT);

    expect(watchers.count(DEPLOYMENT)).toBe(2);
    expect(first.send).toHaveBeenCalledWith(EVENT);
    expect(second.send).toHaveBeenCalledWith(EVENT);
    expect(elsewhere.send).not.toHaveBeenCalled();
  });

  it("forgets a deployment once its last connection unwatches", () => {
    const watchers = createDeploymentWatchers();
    const unwatchFirst = watchers.watch(DEPLOYMENT, connection());
    const second = connection();
    const unwatchSecond = watchers.watch(DEPLOYMENT, second);

    unwatchFirst();
    watchers.notify(DEPLOYMENT, EVENT);
    expect(watchers.count(DEPLOYMENT)).toBe(1);
    expect(second.send).toHaveBeenCalledWith(EVENT);

    unwatchSecond();
    expect(watchers.has(DEPLOYMENT)).toBe(false);
  });

  it("does not drop a connection registered after a stale unwatch", () => {
    const watchers = createDeploymentWatchers();
    const unwatchOld = watchers.watch(DEPLOYMENT, connection());
    unwatchOld();
    const current = connection();
    watchers.watch(DEPLOYMENT, current);

    unwatchOld();
    watchers.notify(DEPLOYMENT, EVENT);

    expect(current.send).toHaveBeenCalledWith(EVENT);
  });

  it("remembers a watched deployment's tasks until they are untracked", () => {
    const watchers = createDeploymentWatchers();

    watchers.trackTask("task-1", DEPLOYMENT, "STOP");

    expect(watchers.untrackTask("task-1")).toEqual({ deploymentId: DEPLOYMENT, task: "STOP" });
    expect(watchers.untrackTask("task-1")).toBeUndefined();
    expect(watchers.untrackTask("never-seen")).toBeUndefined();
  });

  it("closes every connection on closeAll", () => {
    const watchers = createDeploymentWatchers();
    const first = connection();
    const second = connection();
    const elsewhere = connection();
    // Connections unwatch themselves when closed, as the handler's do.
    const unwatchFirst = watchers.watch(DEPLOYMENT, first);
    first.close.mockImplementation(unwatchFirst);
    watchers.watch(DEPLOYMENT, second);
    watchers.watch(OTHER_DEPLOYMENT, elsewhere);

    watchers.closeAll();

    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).toHaveBeenCalledOnce();
    expect(elsewhere.close).toHaveBeenCalledOnce();
  });
});

describe("stream events", () => {
  it("maps a deployment document to its status event", () => {
    const doc = { id: DEPLOYMENT, status: "RUNNING", replicas: 2, active_revision: 3 } as DeploymentDocument;

    expect(toDeploymentEvent(doc)).toEqual(EVENT);
  });

  it("maps a job document to its lifecycle event, with no end time reading as 0", () => {
    const doc = { job: "j", state: JobState.RUNNING, node: "n", time_start: 10, revision: 2, created_at: new Date("2026-08-22T10:00:00.000Z") } as JobsDocument;

    expect(toJobEvent(doc)).toEqual({ type: "job", job: "j", state: "RUNNING", node: "n", timeStart: 10, timeEnd: 0, revision: 2, created_at: "2026-08-22T10:00:00.000Z" });
  });

  it("maps an event-log entry, keeping its own type as `event` and a missing tx as null", () => {
    const created_at = new Date("2026-08-22T10:00:00.000Z");
    const doc: EventDocument = { category: "Deployment", deploymentId: DEPLOYMENT, type: "DEPLOYMENT_STARTED", message: "started", created_at };

    expect(toLogEvent(doc)).toEqual({
      type: "event", category: "Deployment", event: "DEPLOYMENT_STARTED", message: "started", tx: null, created_at: "2026-08-22T10:00:00.000Z",
    });
    expect(toLogEvent({ ...doc, tx: "sig" })).toMatchObject({ tx: "sig" });
  });

  it("maps a task document and a task deletion", () => {
    const due_at = new Date("2026-08-22T10:05:00.000Z");
    const doc = { _id: "task-1", deploymentId: DEPLOYMENT, task: "STOP", status: "PENDING", attempts: 0, due_at, job: "j" } as unknown as WithId<TaskDocument>;

    expect(toTaskEvent(doc)).toEqual({
      type: "task", id: "task-1", task: "STOP", status: "PENDING", attempts: 0, due_at: "2026-08-22T10:05:00.000Z", job: "j",
    });
    expect(toTaskEvent({ ...doc, job: undefined })).toMatchObject({ job: null });
    expect(toTaskDoneEvent("task-1", "STOP")).toEqual({ type: "task", id: "task-1", task: "STOP", status: "DONE" });
  });
});
