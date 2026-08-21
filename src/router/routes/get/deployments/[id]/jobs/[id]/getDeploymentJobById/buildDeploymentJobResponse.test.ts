import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Job } from "@nosana/kit";

import { buildDeploymentJobResponse, lifecycleOf } from "./buildDeploymentJobResponse.js";
import { JobState, type DeploymentDocument, type JobResultsDocument, type JobsDocument, type RevisionDocument } from "../../../../../../../../types/index.js";

const retrieve = vi.fn();
vi.mock("../../../../../../../../kit/index.js", () => ({
  getKit: () => ({ ipfs: { retrieve } }),
}));

const NODE = "HS7ZbbBYbLVSs1gUA5vEQQF6oLWSKus3wri2QiYjdUjW";
const PLACEHOLDER = "11111111111111111111111111111111";
const LISTED_AT = new Date("2026-08-22T10:00:00.000Z");

const record = (overrides: Partial<JobsDocument> = {}): JobsDocument =>
  ({ job: "j", revision: 2, state: JobState.QUEUED, node: null, time_start: 0, created_at: LISTED_AT, ...overrides }) as JobsDocument;

const account = (overrides: Partial<Job> = {}): Job =>
  ({ state: 1, node: NODE, timeStart: 100, timeEnd: 0, ipfsResult: null, ...overrides }) as Job;

const deployment = { confidential: false, market: "market" } as DeploymentDocument;
const revision = { job_definition: { ops: [] } } as unknown as RevisionDocument;
const results = { job: "j", results: { status: "success" } } as unknown as JobResultsDocument;

describe("lifecycleOf", () => {
  it("reports the chain while the account exists, even if our record lags", () => {
    expect(lifecycleOf(record(), account({ state: 2, timeEnd: 200, ipfsResult: "Qm" }))).toEqual({
      state: 2, node: NODE, timeStart: 100, timeEnd: 200, ipfsResult: "Qm",
    });
  });

  it("falls back to our record once the account is gone", () => {
    expect(lifecycleOf(record({ state: JobState.STOPPED, node: NODE, time_start: 5, time_end: 9 }), null)).toEqual({
      state: 3, node: NODE, timeStart: 5, timeEnd: 9, ipfsResult: null,
    });
  });

  it("reports the placeholder node and no end time for an unclaimed record", () => {
    expect(lifecycleOf(record(), null)).toMatchObject({ state: 0, node: PLACEHOLDER, timeEnd: 0 });
  });
});

describe("buildDeploymentJobResponse", () => {
  beforeEach(() => retrieve.mockReset());

  it("serves the lifecycle, the definition, and listedAt from our record, with no node-reported status", async () => {
    const response = await buildDeploymentJobResponse(deployment, record(), revision, null, account());

    expect(response).toEqual({
      confidential: false,
      revision: 2,
      market: "market",
      node: NODE,
      state: 1,
      jobStatus: null,
      jobDefinition: { ops: [] },
      jobResult: null,
      timeStart: 100,
      timeEnd: 0,
      listedAt: Math.floor(LISTED_AT.getTime() / 1000),
    });
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("serves results the node reported without touching IPFS", async () => {
    const response = await buildDeploymentJobResponse(deployment, record(), revision, results, account({ state: 2, ipfsResult: "Qm" }));

    expect(response.jobResult).toEqual({ status: "success" });
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("retrieves results pinned on-chain when the node reported none and the job is finished", async () => {
    retrieve.mockResolvedValue({ status: "from-ipfs" });

    const response = await buildDeploymentJobResponse(deployment, record(), revision, null, account({ state: 2, ipfsResult: "Qm" }));

    expect(retrieve).toHaveBeenCalledWith("Qm");
    expect(response.jobResult).toEqual({ status: "from-ipfs" });
  });

  it("does not look up IPFS while the job is still running, or when nothing was pinned", async () => {
    await buildDeploymentJobResponse(deployment, record(), revision, null, account({ state: 1, ipfsResult: "Qm" }));
    await buildDeploymentJobResponse(deployment, record(), revision, null, account({ state: 2, ipfsResult: null }));
    await buildDeploymentJobResponse(deployment, record({ state: JobState.STOPPED }), revision, null, null);

    expect(retrieve).not.toHaveBeenCalled();
  });
});
