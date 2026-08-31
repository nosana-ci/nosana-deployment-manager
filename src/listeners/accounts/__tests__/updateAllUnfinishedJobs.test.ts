import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Db } from "mongodb";
import type { NosanaClient } from "@nosana/kit";

import { updateAllUnfinishedJobs } from "../updateAllUnfinishedJobs.js";

import { JobState } from "../../../types/index.js";

const bulkWrite = vi.fn();
const db = { collection: () => ({ bulkWrite }) } as unknown as Db;

const kitWith = (...jobs: { address: string; state: number }[]) =>
  ({
    jobs: {
      all: async () =>
        jobs.map(({ address, state }) => ({
          address: { toString: () => address },
          state,
          timeStart: 1,
          timeEnd: 0,
        })),
    },
  }) as unknown as NosanaClient;

const filterOf = (index: number) =>
  (bulkWrite.mock.calls[0][0][index] as { updateOne: { filter: unknown } }).updateOne.filter;

describe("updateAllUnfinishedJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("refuses to move a job that has already finished", async () => {
    // `kit.jobs.all()` is a snapshot: a job it saw RUNNING may have completed
    // before this write lands, and must not be dragged back.
    await updateAllUnfinishedJobs(kitWith({ address: "job-a", state: 1 }), db);

    expect(filterOf(0)).toEqual({
      job: "job-a",
      state: { $nin: [JobState.COMPLETED, JobState.STOPPED] },
    });
  });

  it("skips jobs still queued on chain", async () => {
    await updateAllUnfinishedJobs(kitWith({ address: "job-a", state: 0 }), db);

    expect(bulkWrite).not.toHaveBeenCalled();
  });
});
