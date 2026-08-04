import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../client/frps/index.js", () => ({
  fetchLiveProxies: vi.fn(),
}));

vi.mock("../../strategies/infinite/frps/endpointStatus.js", () => ({
  recordEndpointState: vi.fn().mockResolvedValue(undefined),
}));

import { runGapRecovery } from "./gapRecovery.js";
import { fetchLiveProxies, type LiveProxy } from "../../client/frps/index.js";
import { recordEndpointState } from "../../strategies/infinite/frps/endpointStatus.js";

const mockedFetch = vi.mocked(fetchLiveProxies);
const mockedRecord = vi.mocked(recordEndpointState);

function proxy(jobId: string, opId: string | undefined): LiveProxy {
  return { name: `${jobId}-${opId}`, jobId, opId, deploymentId: "dep-1" };
}

describe("runGapRecovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRecord.mockResolvedValue(undefined);
  });

  it("leaves the baseline untouched when the proxy list can't be read", async () => {
    mockedFetch.mockResolvedValue(null);

    await runGapRecovery();

    expect(mockedRecord).not.toHaveBeenCalled();
  });

  it("marks every online endpoint up and never stops anything", async () => {
    mockedFetch.mockResolvedValue([proxy("job-1", "op-a"), proxy("job-1", "op-b")]);

    await runGapRecovery();

    // Every recorded state is "up" — a reason-blind snapshot must never drive a
    // teardown, only re-seed what is currently live.
    expect(mockedRecord).toHaveBeenCalledTimes(2);
    for (const call of mockedRecord.mock.calls) {
      expect(call[0].state).toBe("up");
    }
  });

  it("skips proxies with no opId, which can't be keyed", async () => {
    mockedFetch.mockResolvedValue([proxy("job-1", undefined), proxy("job-2", "op-a")]);

    await runGapRecovery();

    expect(mockedRecord).toHaveBeenCalledOnce();
    expect(mockedRecord).toHaveBeenCalledWith(expect.objectContaining({ job: "job-2", opId: "op-a" }));
  });
});
