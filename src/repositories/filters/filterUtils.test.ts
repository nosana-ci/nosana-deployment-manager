import { describe, expect, it } from "vitest";

import { buildMarketFilter, buildNestedMultiValueFilter } from "./filterUtils.js";

describe("buildMarketFilter", () => {
  it("matches one address, several, or none for deployments without a market", () => {
    expect(buildMarketFilter("market", undefined)).toBeUndefined();
    expect(buildMarketFilter("market", "A")).toEqual({ market: "A" });
    expect(buildMarketFilter("market", "A,B")).toEqual({ market: { $in: ["A", "B"] } });
    expect(buildMarketFilter("market", "none")).toEqual({ market: null });
    expect(buildMarketFilter("market", "none,A")).toEqual({ market: { $in: [null, "A"] } });
  });
});

describe("buildNestedMultiValueFilter", () => {
  it("matches a scalar or any list element at the path", () => {
    expect(buildNestedMultiValueFilter("requirements.name", undefined)).toBeUndefined();
    expect(buildNestedMultiValueFilter("requirements.name", "RTX 4090")).toEqual({ "requirements.name": "RTX 4090" });
    expect(buildNestedMultiValueFilter("requirements.name", "RTX 4090, RTX 5090")).toEqual({
      "requirements.name": { $in: ["RTX 4090", "RTX 5090"] },
    });
  });

  it("treats none as a literal unless told it means missing", () => {
    expect(buildNestedMultiValueFilter("requirements.name", "none")).toEqual({ "requirements.name": "none" });
    expect(buildNestedMultiValueFilter("requirements.name", "none", { noneMeansMissing: true })).toEqual({
      "requirements.name": { $exists: false },
    });
    expect(buildNestedMultiValueFilter("requirements.name", "none,RTX 4090", { noneMeansMissing: true })).toEqual({
      $or: [{ "requirements.name": "RTX 4090" }, { "requirements.name": { $exists: false } }],
    });
  });
});
