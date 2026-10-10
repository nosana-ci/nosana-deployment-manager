import { describe, it, expect, vi } from "vitest";
import type { Db } from "mongodb";

import { deploymentReservationTermsUpdate } from "../deploymentReservationTermsUpdate.js";
import { DeploymentDocumentFields, type DeploymentDocument } from "../../../types/index.js";
import { OnEvent } from "../../../client/listener/types.js";

const [eventType, handler, options] = deploymentReservationTermsUpdate;

describe("deploymentReservationTermsUpdate", () => {
  it("is an UPDATE listener keyed on the market and the requirements", () => {
    expect(eventType).toBe(OnEvent.UPDATE);
    expect(options?.fields).toEqual([DeploymentDocumentFields.MARKET, DeploymentDocumentFields.REQUIREMENTS]);
  });

  it("makes the deployment's parked LIST tasks due now, so they hand off to the new terms", async () => {
    const updateMany = vi.fn(async () => ({ acknowledged: true }));
    const collection = vi.fn(() => ({ updateMany }));
    const db = { collection } as unknown as Db;

    handler({ id: "dep-1" } as DeploymentDocument, db);
    await vi.waitFor(() => expect(updateMany).toHaveBeenCalled());

    expect(collection).toHaveBeenCalledWith("tasks");
    expect(updateMany).toHaveBeenCalledWith(
      { deploymentId: "dep-1", task: "LIST", status: "PENDING", reservation_request: { $exists: true } },
      { $set: { due_at: expect.any(Date) } }
    );
  });

  it("never throws when the write fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const updateMany = vi.fn(async () => {
      throw new Error("mongo down");
    });
    const db = { collection: () => ({ updateMany }) } as unknown as Db;

    expect(() => handler({ id: "dep-1" } as DeploymentDocument, db)).not.toThrow();
    await vi.waitFor(() => expect(console.error).toHaveBeenCalled());
    vi.restoreAllMocks();
  });
});
