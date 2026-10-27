import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Db } from "mongodb";

import stopIdleDeployments from "../21-stopIdleDeployments.js";

const updateMany = vi.fn(async () => ({ modifiedCount: 2 }));
const jobsDistinct = vi.fn();
const tasksDistinct = vi.fn();
const db = {
  collection: (name: string) =>
    name === "deployments"
      ? { updateMany }
      : { distinct: name === "jobs" ? jobsDistinct : tasksDistinct },
} as unknown as Db;

describe("stopIdleDeployments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
    vi.spyOn(console, "log").mockImplementation(() => {});
    jobsDistinct.mockResolvedValue(["dep-live", "dep-both"]);
    tasksDistinct.mockResolvedValue(["dep-tasked", "dep-both"]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops every idle RUNNING deployment, and idle INSUFFICIENT_FUNDS ones untouched for a week", async () => {
    await stopIdleDeployments(db);

    expect(jobsDistinct).toHaveBeenCalledWith("deployment", { state: { $in: ["QUEUED", "RUNNING"] } });
    expect(tasksDistinct).toHaveBeenCalledWith("deploymentId");
    expect(updateMany).toHaveBeenCalledExactlyOnceWith(
      {
        id: { $nin: ["dep-live", "dep-both", "dep-tasked"] },
        $or: [
          { status: "RUNNING" },
          { status: "INSUFFICIENT_FUNDS", updated_at: { $lt: new Date("2026-10-20T12:00:00Z") } },
        ],
      },
      { $set: { status: "STOPPED" } }
    );
  });
});
