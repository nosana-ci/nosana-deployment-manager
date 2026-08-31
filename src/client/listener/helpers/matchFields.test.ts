import { describe, it, expect } from "vitest";

import { matchFields } from "./matchFields.js";

describe("matchFields", () => {
  it("matches a field written directly", () => {
    expect(matchFields({ status: "RUNNING" }, ["status", "replicas"])).toBe(true);
  });

  it("ignores an update that touched nothing of interest", () => {
    expect(matchFields({ updated_at: new Date() }, ["status"])).toBe(false);
  });

  describe("nested writes", () => {
    // Captured from a real change stream (mongo 8.0): `$set` of
    // `endpoints.$[e].online` with arrayFilters matching ONE element.
    const oneElement = { "endpoints.0.online": true };
    // The same write when the filter matched SEVERAL elements — mongo collapses
    // the diff to the whole array.
    const wholeArray = { endpoints: [{ opId: "api", online: true }] };

    it("matches the dotted path a single-element array write produces", () => {
      // An exact key check drops this, which is the bug it exists to prevent:
      // the endpoint frames never reached the stream.
      expect(matchFields(oneElement, ["endpoints"])).toBe(true);
    });

    it("matches the whole-array shape too", () => {
      expect(matchFields(wholeArray, ["endpoints"])).toBe(true);
    });

    it("matches a nested object path", () => {
      expect(matchFields({ "vault.balance": 5 }, ["vault"])).toBe(true);
    });
  });

  it("does not let a prefix match a different field", () => {
    expect(matchFields({ endpointsArchive: [] }, ["endpoints"])).toBe(false);
    expect(matchFields({ "endpointsArchive.0.online": true }, ["endpoints"])).toBe(false);
  });

  it("is false when nothing was updated", () => {
    expect(matchFields({}, ["status"])).toBe(false);
  });
});
