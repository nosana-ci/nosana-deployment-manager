import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";

import migrateEndpointsToOnline from "../18-migrateEndpointsToOnline.js";

import { JobState } from "../../../../types/index.js";

const DEPLOYMENT = "deployment-1";
const OTHER = "deployment-2";

const bulkWrite = vi.fn();
const cursors: Record<string, unknown[]> = { deployments: [], jobs: [], frps_endpoint_status: [] };
const find = vi.fn();

/** A find()/project()/toArray() chain over the canned rows for a collection. */
const collection = (name: string) => ({
  find: (...args: unknown[]) => {
    find(name, ...args);
    const chain = {
      project: () => chain,
      toArray: async () => cursors[name],
    };
    return chain;
  },
  bulkWrite,
});

const db = { collection: (name: string) => collection(name) } as unknown as Db;

const arrayFiltersOf = (index: number) =>
  (bulkWrite.mock.calls[0][0][index] as { updateOne: { arrayFilters: unknown[] } }).updateOne.arrayFilters;

describe("migrateEndpointsToOnline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cursors.deployments = [];
    cursors.jobs = [];
    cursors.frps_endpoint_status = [];
  });

  it("selects only deployments with an endpoint missing the field", async () => {
    await migrateEndpointsToOnline(db);

    expect(find).toHaveBeenCalledWith("deployments", {
      endpoints: { $elemMatch: { online: { $exists: false } } },
    });
  });

  it("writes nothing when every endpoint already has it", async () => {
    await migrateEndpointsToOnline(db);

    expect(bulkWrite).not.toHaveBeenCalled();
    // Nothing to backfill means nothing to compute either.
    expect(find).toHaveBeenCalledTimes(1);
  });

  it("marks an op online when its tunnel is up on a RUNNING job", async () => {
    cursors.deployments = [{ id: DEPLOYMENT }];
    cursors.jobs = [{ job: "job-a" }];
    cursors.frps_endpoint_status = [{ deploymentId: DEPLOYMENT, job: "job-a", opId: "api" }];

    await migrateEndpointsToOnline(db);

    expect(arrayFiltersOf(0)).toEqual([
      { "endpoint.opId": { $in: ["api"] }, "endpoint.online": { $exists: false } },
    ]);
    expect(arrayFiltersOf(1)).toEqual([
      { "endpoint.opId": { $nin: ["api"] }, "endpoint.online": { $exists: false } },
    ]);
  });

  it("does not trust a tunnel whose job is no longer RUNNING", async () => {
    cursors.deployments = [{ id: DEPLOYMENT }];
    cursors.jobs = [];
    cursors.frps_endpoint_status = [{ deploymentId: DEPLOYMENT, job: "dead-job", opId: "api" }];

    await migrateEndpointsToOnline(db);

    // Nothing online: the second update fills every endpoint with false.
    expect(arrayFiltersOf(0)).toEqual([
      { "endpoint.opId": { $in: [] }, "endpoint.online": { $exists: false } },
    ]);
    expect(arrayFiltersOf(1)).toEqual([
      { "endpoint.opId": { $nin: [] }, "endpoint.online": { $exists: false } },
    ]);
  });

  it("asks only for RUNNING jobs and up tunnels of the deployments it is fixing", async () => {
    cursors.deployments = [{ id: DEPLOYMENT }, { id: OTHER }];

    await migrateEndpointsToOnline(db);

    expect(find).toHaveBeenCalledWith("jobs", {
      deployment: { $in: [DEPLOYMENT, OTHER] },
      state: JobState.RUNNING,
    });
    expect(find).toHaveBeenCalledWith("frps_endpoint_status", {
      deploymentId: { $in: [DEPLOYMENT, OTHER] },
      state: "up",
    });
  });

  it("keeps deployments apart", async () => {
    cursors.deployments = [{ id: DEPLOYMENT }, { id: OTHER }];
    cursors.jobs = [{ job: "job-a" }, { job: "job-b" }];
    cursors.frps_endpoint_status = [
      { deploymentId: DEPLOYMENT, job: "job-a", opId: "api" },
      { deploymentId: OTHER, job: "job-b", opId: "ui" },
    ];

    await migrateEndpointsToOnline(db);

    expect(arrayFiltersOf(0)).toEqual([
      { "endpoint.opId": { $in: ["api"] }, "endpoint.online": { $exists: false } },
    ]);
    expect(arrayFiltersOf(2)).toEqual([
      { "endpoint.opId": { $in: ["ui"] }, "endpoint.online": { $exists: false } },
    ]);
  });

  it("never touches updated_at, which gates the rapid-completion fail-safe", async () => {
    cursors.deployments = [{ id: DEPLOYMENT }];

    await migrateEndpointsToOnline(db);

    expect(JSON.stringify(bulkWrite.mock.calls[0][0])).not.toContain("updated_at");
  });
});
