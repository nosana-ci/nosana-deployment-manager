import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";

vi.mock("../../../endpoints/deploymentEndpointStatus.js", () => ({
  refreshDeploymentEndpointStatus: vi.fn(),
}));

import { jobEndpointStatusUpdate } from "../jobEndpointStatusUpdate.js";
import { refreshDeploymentEndpointStatus } from "../../../endpoints/deploymentEndpointStatus.js";

import { OnEvent } from "../../../client/listener/types.js";
import { type JobsDocument, JobsDocumentFields, JobState } from "../../../types/index.js";

const DEPLOYMENT = "deployment-1";

const [eventType, handler, options] = jobEndpointStatusUpdate;
const mockedRefresh = vi.mocked(refreshDeploymentEndpointStatus);

const job = (state: JobState): JobsDocument =>
  ({ job: "job-1", deployment: DEPLOYMENT, state }) as JobsDocument;

describe("jobEndpointStatusUpdate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("listens to job state changes", () => {
    expect(eventType).toBe(OnEvent.UPDATE);
    expect(options?.fields).toEqual([JobsDocumentFields.STATE]);
  });

  it("takes every state, not just the settled ones", () => {
    // A job reaching RUNNING settles the tunnel-registered-first race; a job
    // leaving RUNNING is what retires an endpoint whose row still reads up.
    expect(options?.filters).toBeUndefined();
  });

  it("refreshes the deployment when a job settles", async () => {
    await handler(job(JobState.STOPPED), {} as Db);

    expect(mockedRefresh).toHaveBeenCalledExactlyOnceWith(DEPLOYMENT);
  });

  it("refreshes the deployment when a job starts running", async () => {
    await handler(job(JobState.RUNNING), {} as Db);

    expect(mockedRefresh).toHaveBeenCalledExactlyOnceWith(DEPLOYMENT);
  });
});
