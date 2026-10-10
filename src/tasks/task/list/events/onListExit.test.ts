import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

import type { OutstandingTasksDocument } from "../../../../types/index.js";

const insertOne = vi.fn();
vi.mock("../../../../repositories/index.js", () => ({
  getRepository: () => ({ collection: { insertOne: (...a: unknown[]) => insertOne(...a) } }),
}));

import { onListExit } from "./onListExit.js";

const scheduledTask = (over: Record<string, unknown> = {}) =>
  ({
    _id: new ObjectId(),
    deploymentId: "dep-1",
    due_at: new Date("2026-10-10T12:00:00.000Z"),
    deployment: { strategy: "SCHEDULED", schedule: "*/5 * * * *" },
    ...over,
  }) as unknown as OutstandingTasksDocument;

describe("onListExit", () => {
  beforeEach(() => {
    insertOne.mockReset().mockResolvedValue({ acknowledged: true });
  });

  it("enqueues the next cron firing of a SCHEDULED deployment", async () => {
    await onListExit(scheduledTask());

    expect(insertOne).toHaveBeenCalledWith(expect.objectContaining({ task: "LIST", deploymentId: "dep-1" }));
  });

  it("does not for a hand-off: its source task already did", async () => {
    await onListExit(scheduledTask({ handoff_of: new ObjectId() }));

    expect(insertOne).not.toHaveBeenCalled();
  });
});
