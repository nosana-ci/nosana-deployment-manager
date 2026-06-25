import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  classifyTaskError,
  shouldRetry,
  retryDelayMs,
  applyRetryState,
  clearRetryState,
} from "./index.js";
import { DeploymentStatus } from "../../../types/index.js";
import type { DeploymentCollection, OutstandingTasksDocument } from "../../../types/index.js";

function task(inflightRetries?: number): OutstandingTasksDocument {
  return { inflight_retries: inflightRetries } as unknown as OutstandingTasksDocument;
}

describe("classifyTaskError", () => {
  it("flags InsufficientFundsForRent", () => {
    expect(classifyTaskError("Error: InsufficientFundsForRent at ...").insufficientFunds).toBe(true);
  });

  it("treats any other error as a standard retry", () => {
    expect(classifyTaskError("Transaction simulation failed").insufficientFunds).toBe(false);
  });
});

describe("shouldRetry", () => {
  it("never retries an aborted run, even with a signal", () => {
    expect(shouldRetry({ aborted: true, retry: false }, { insufficientFunds: false })).toBe(false);
  });

  it("retries on an in-flight result or a handled-error signal", () => {
    expect(shouldRetry({ aborted: false, retry: true }, undefined)).toBe(true);
    expect(shouldRetry({ aborted: false, retry: false }, { insufficientFunds: false })).toBe(true);
  });

  it("completes when there is neither", () => {
    expect(shouldRetry({ aborted: false, retry: false }, undefined)).toBe(false);
  });
});

describe("retryDelayMs", () => {
  it("escalates a handled error with inflight_retries", () => {
    const first = retryDelayMs(task(0), {}, { insufficientFunds: false });
    const later = retryDelayMs(task(3), {}, { insufficientFunds: false });
    expect(later).toBeGreaterThan(first);
  });

  it("honours the CM Retry-After as a floor for a handled error", () => {
    const hugeHint = 999_999_999;
    expect(retryDelayMs(task(0), { retryAfterMs: hugeHint }, { insufficientFunds: false })).toBe(hugeHint);
  });

  it("uses the slower funds ladder for an insufficient-funds error", () => {
    const standard = retryDelayMs(task(0), {}, { insufficientFunds: false });
    const funds = retryDelayMs(task(0), {}, { insufficientFunds: true });
    expect(funds).toBeGreaterThan(standard);
  });

  it("does NOT escalate an in-flight wait — polls at the CM cadence", () => {
    // No signal = CM IN_PROGRESS / in-flight: honour the hint exactly...
    expect(retryDelayMs(task(50), { retryAfterMs: 2_000 }, undefined)).toBe(2_000);
    // ...and a high inflight_retries must NOT inflate the in-flight delay the way
    // a handled error would.
    const inflight = retryDelayMs(task(50), {}, undefined);
    const errored = retryDelayMs(task(50), {}, { insufficientFunds: false });
    expect(inflight).toBeLessThan(errored);
  });
});

describe("applyRetryState / clearRetryState", () => {
  const updateOne = vi.fn(async () => ({}));
  const deployments = { updateOne } as unknown as DeploymentCollection;

  beforeEach(() => updateOne.mockClear());

  it("stamps next_retry_at and leaves status alone for a standard retry", async () => {
    await applyRetryState(deployments, "dep-1", { insufficientFunds: false }, 5_000);
    // Only the next_retry_at stamp — no status flip.
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(updateOne).toHaveBeenCalledWith(
      { id: "dep-1" },
      { $set: { next_retry_at: expect.any(Date) } }
    );
  });

  it("surfaces INSUFFICIENT_FUNDS from a RUNNING deployment on a funds retry", async () => {
    await applyRetryState(deployments, "dep-1", { insufficientFunds: true }, 5_000);
    expect(updateOne).toHaveBeenCalledWith(
      { id: "dep-1", status: DeploymentStatus.RUNNING },
      { $set: { status: DeploymentStatus.INSUFFICIENT_FUNDS } }
    );
  });

  it("restores RUNNING and clears the stamp on success", async () => {
    await clearRetryState(deployments, "dep-1");
    expect(updateOne).toHaveBeenCalledWith(
      { id: "dep-1", status: DeploymentStatus.INSUFFICIENT_FUNDS },
      { $set: { status: DeploymentStatus.RUNNING } }
    );
    expect(updateOne).toHaveBeenCalledWith({ id: "dep-1" }, { $unset: { next_retry_at: "" } });
  });
});
