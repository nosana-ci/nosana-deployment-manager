import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../repositories/index.js", () => ({
  FrpsEndpointStatusRepository: { collection: { updateOne: vi.fn() } },
}));

import { recordEndpointState } from "./endpointStatus.js";
import { FrpsEndpointStatusRepository } from "../../../repositories/index.js";

const mockedUpdateOne = vi.mocked(FrpsEndpointStatusRepository.collection.updateOne);

const KEY = { job: "job-1", opId: "op-1", deploymentId: "dep-1" };

describe("recordEndpointState", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stamps last_change on a real transition and stops there", async () => {
    // The state-changing update matched, so the second (no-op refresh) upsert
    // must not run.
    mockedUpdateOne.mockResolvedValueOnce({ matchedCount: 1 } as never);

    await recordEndpointState({ ...KEY, state: "up" });

    expect(mockedUpdateOne).toHaveBeenCalledOnce();
    const [filter, update] = mockedUpdateOne.mock.calls[0];
    expect(filter).toMatchObject({ job: "job-1", opId: "op-1", state: { $ne: "up" } });
    expect((update as { $set: Record<string, unknown> }).$set).toHaveProperty("last_change");
  });

  it("upserts without moving last_change when the state is unchanged", async () => {
    mockedUpdateOne
      .mockResolvedValueOnce({ matchedCount: 0 } as never) // no transition
      .mockResolvedValueOnce({ matchedCount: 1 } as never);

    await recordEndpointState({ ...KEY, state: "up" });

    expect(mockedUpdateOne).toHaveBeenCalledTimes(2);
    const [, secondUpdate] = mockedUpdateOne.mock.calls[1];
    const [, , options] = mockedUpdateOne.mock.calls[1];
    expect(options).toMatchObject({ upsert: true });
    // last_change only on insert, never bumped for an unchanged state.
    expect((secondUpdate as { $setOnInsert: Record<string, unknown> }).$setOnInsert).toHaveProperty("last_change");
    expect((secondUpdate as { $set: Record<string, unknown> }).$set).not.toHaveProperty("last_change");
  });

  it("clears the reason when marking up", async () => {
    mockedUpdateOne.mockResolvedValue({ matchedCount: 1 } as never);

    await recordEndpointState({ ...KEY, state: "up" });

    const [, update] = mockedUpdateOne.mock.calls[0];
    expect(update).toHaveProperty("$unset", { reason: "" });
  });

  it("records the reason when marking down", async () => {
    mockedUpdateOne.mockResolvedValue({ matchedCount: 1 } as never);

    await recordEndpointState({ ...KEY, state: "down", reason: "lost" });

    const [, update] = mockedUpdateOne.mock.calls[0];
    expect((update as { $set: Record<string, unknown> }).$set).toMatchObject({ state: "down", reason: "lost" });
    expect(update).not.toHaveProperty("$unset");
  });
});
