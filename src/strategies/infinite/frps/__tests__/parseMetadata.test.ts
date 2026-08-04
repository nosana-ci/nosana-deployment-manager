import { describe, it, expect } from "vitest";

import { parseFrpsMetadata } from "../parseMetadata.js";

describe("parseFrpsMetadata", () => {
  it("reads a single merged metadata object", () => {
    expect(
      parseFrpsMetadata([{ deploymentId: "dep-1", opId: "op-1", jobId: "job-1" }])
    ).toEqual({ deploymentId: "dep-1", opId: "op-1", jobId: "job-1" });
  });

  it("merges metadata split across one object per key", () => {
    // The shape that broke the original implementation: spreading into `new Map`
    // kept only the first entry, silently losing the jobId.
    expect(
      parseFrpsMetadata([{ deploymentId: "dep-1" }, { opId: "op-1" }, { jobId: "job-1" }])
    ).toEqual({ deploymentId: "dep-1", opId: "op-1", jobId: "job-1" });
  });

  it("returns an empty object for undefined or empty metadata", () => {
    expect(parseFrpsMetadata(undefined)).toEqual({});
    expect(parseFrpsMetadata([])).toEqual({});
    expect(parseFrpsMetadata([{}])).toEqual({});
  });

  it("drops empty and nullish values so callers can truth-test the result", () => {
    expect(
      parseFrpsMetadata([{ deploymentId: "dep-1", jobId: "", opId: undefined }])
    ).toEqual({ deploymentId: "dep-1" });
  });

  it("keeps the last value when a key is repeated", () => {
    expect(parseFrpsMetadata([{ jobId: "job-1" }, { jobId: "job-2" }])).toEqual({
      jobId: "job-2",
    });
  });
});
