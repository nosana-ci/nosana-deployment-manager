import { describe, it, expect, vi } from "vitest";
import type { Db } from "mongodb";

import { updateScheduledTasks } from "./updateScheduledTasks.js";

describe("updateScheduledTasks", () => {
  it("moves only the pending cron LISTs, never a STOP", async () => {
    const updateMany = vi.fn(async () => ({ acknowledged: true }));
    const db = { collection: () => ({ updateMany }) } as unknown as Db;
    const due_at = new Date("2026-10-10T12:00:00.000Z");

    await updateScheduledTasks(db, "dep-1", due_at);

    expect(updateMany).toHaveBeenCalledWith(
      { deploymentId: { $eq: "dep-1" }, task: "LIST", tx: { $eq: null } },
      { $set: { due_at } }
    );
  });
});
