import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";

import { TaskType } from "../../../../types/index.js";
import type { EventsCollection, OutstandingTasksDocument } from "../../../../types/index.js";

const scheduleTask = vi.fn();
vi.mock("../../../scheduleTask.js", () => ({ scheduleTask: (...a: unknown[]) => scheduleTask(...a) }));

import { onExtendConfirmed } from "./onExtendConfirmed.js";

const task = {
  deploymentId: "dep-1",
  deployment: { status: "RUNNING", timeout: 3600 },
} as unknown as OutstandingTasksDocument;

const insertOne = vi.fn(async () => ({ acknowledged: true }));
const events = { insertOne } as unknown as EventsCollection;
const db = {} as Db;

beforeEach(() => {
  scheduleTask.mockReset();
  insertOne.mockClear();
});

describe("onExtendConfirmed", () => {
  it("schedules the next extend idempotently and logs the success on a fresh confirm", async () => {
    scheduleTask.mockResolvedValueOnce(true);

    await onExtendConfirmed(events, task, db, "sig-1", "job-1");

    expect(scheduleTask).toHaveBeenCalledWith(
      db,
      TaskType.EXTEND,
      "dep-1",
      "RUNNING",
      expect.any(Date),
      { job: "job-1", idempotent: true }
    );
    expect(insertOne).toHaveBeenCalledOnce();
  });

  it("a reclaim replay (next extend already pending) does NOT double-schedule or double-log", async () => {
    scheduleTask.mockResolvedValueOnce(false);

    await onExtendConfirmed(events, task, db, "sig-1", "job-1");

    expect(scheduleTask).toHaveBeenCalledOnce();
    expect(insertOne).not.toHaveBeenCalled();
  });
});
