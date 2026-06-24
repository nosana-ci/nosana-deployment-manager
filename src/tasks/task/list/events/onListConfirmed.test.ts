import { describe, it, expect, vi } from "vitest";

import { onListConfirmed } from "./onListConfirmed.js";
import {
  EventsCollection,
  JobsCollection,
  OutstandingTasksDocument,
} from "../../../../types/index.js";

const task = {
  deploymentId: "dep-1",
  deployment: { market: "mkt-1", active_revision: 2 },
} as unknown as OutstandingTasksDocument;

function fakes(upsertedCount: number) {
  const updateOne = vi.fn(async () => ({ acknowledged: true, upsertedCount, matchedCount: 1 }));
  const insertOne = vi.fn(async () => ({ acknowledged: true }));
  return {
    jobs: { updateOne } as unknown as JobsCollection,
    events: { insertOne } as unknown as EventsCollection,
    updateOne,
    insertOne,
  };
}

describe("onListConfirmed", () => {
  it("upserts the job and emits the event when the job is newly inserted", async () => {
    const { jobs, events, updateOne, insertOne } = fakes(1);

    await onListConfirmed(jobs, events, task, "sig-1", "job-1");

    expect(updateOne).toHaveBeenCalledOnce();
    expect(insertOne).toHaveBeenCalledOnce();
    expect(insertOne.mock.calls[0][0]).toMatchObject({ type: "JOB_LIST_CONFIRMED", tx: "sig-1" });
  });

  it("does NOT emit a duplicate event on an idempotent replay (job already recorded)", async () => {
    const { jobs, events, updateOne, insertOne } = fakes(0);

    await onListConfirmed(jobs, events, task, "sig-1", "job-1");

    expect(updateOne).toHaveBeenCalledOnce(); // upsert still attempted (idempotent no-op)
    expect(insertOne).not.toHaveBeenCalled(); // but no second JOB_LIST_CONFIRMED
  });
});
