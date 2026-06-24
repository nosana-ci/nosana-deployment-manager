import { describe, it, expect } from "vitest";

import { classifyApiError, IdempotencyCode } from "./classify.js";

const coded = (code: string, statusCode = 409) => Object.assign(new Error(code), { code, statusCode });

describe("classifyApiError", () => {
  it("EXPIRED -> EXPIRED (bump epoch, re-post)", () => {
    expect(classifyApiError(coded(IdempotencyCode.EXPIRED))).toBe("EXPIRED");
  });

  it("IN_PROGRESS -> RETRY (re-issue the same key)", () => {
    expect(classifyApiError(coded(IdempotencyCode.IN_PROGRESS))).toBe("RETRY");
  });

  it("PAYLOAD_MISMATCH -> FATAL (client bug, never retry)", () => {
    expect(classifyApiError(coded(IdempotencyCode.PAYLOAD_MISMATCH))).toBe("FATAL");
  });

  it("5xx without a known code -> RETRY (transient)", () => {
    expect(classifyApiError(Object.assign(new Error("boom"), { statusCode: 503 }))).toBe("RETRY");
  });

  it("other 4xx without a known code -> FATAL (definitive)", () => {
    expect(classifyApiError(Object.assign(new Error("bad"), { statusCode: 400 }))).toBe("FATAL");
  });

  it("an unrecognised code on a 4xx -> FATAL (no silent loop)", () => {
    expect(classifyApiError(coded("SOMETHING_ELSE", 422))).toBe("FATAL");
  });

  it("no HTTP response (network/timeout/abort) -> RETRY (could be a lost success)", () => {
    expect(classifyApiError(new Error("fetch failed"))).toBe("RETRY");
    expect(classifyApiError(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe("RETRY");
  });

  it("non-object throws -> RETRY (treated as no response)", () => {
    expect(classifyApiError("weird")).toBe("RETRY");
    expect(classifyApiError(undefined)).toBe("RETRY");
  });
});
