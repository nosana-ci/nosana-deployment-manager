import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ObjectId, type Db, type MongoClient } from "mongodb";

const cancelReservationRequest = vi.fn();
vi.mock("../client/hostManager/index.js", () => ({
  cancelReservationRequest: (...a: unknown[]) => cancelReservationRequest(...a),
}));

import { getRepository, setRepository, TasksRepository } from "./index.js";

const find = vi.fn();
const deleteMany = vi.fn();
const db = {
  collection: () => ({ find: (...a: unknown[]) => ({ toArray: () => find(...a) }), deleteMany }),
} as unknown as Db;

const heldFilter = (filter: object) => ({
  $and: [
    filter,
    { task: "LIST", $or: [{ reservation_request: { $exists: true } }, { reservation: { $exists: true } }] },
  ],
});

beforeEach(() => {
  find.mockReset().mockResolvedValue([]);
  deleteMany.mockReset().mockResolvedValue({ acknowledged: true, deletedCount: 2 });
  cancelReservationRequest.mockReset().mockResolvedValue({ key: "k", status: "cancelled", released: 0 });
  setRepository({} as MongoClient, db);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("repository delete", () => {
  it("deletes every match and returns the driver's result", async () => {
    const result = await getRepository("jobs").delete({ deployment: "dep-1" });

    expect(deleteMany).toHaveBeenCalledWith({ deployment: "dep-1" }, undefined);
    expect(result).toEqual({ acknowledged: true, deletedCount: 2 });
    expect(cancelReservationRequest).not.toHaveBeenCalled();
  });
});

describe("tasks repository delete", () => {
  it("cancels the reservation request of each deleted LIST task that had a request or a hold", async () => {
    const [a, b] = [new ObjectId(), new ObjectId()];
    find.mockResolvedValue([{ _id: a }, { _id: b }]);
    const filter = { deploymentId: "dep-1", task: { $ne: "STOP" } };

    const result = await getRepository("tasks").delete(filter);

    expect(find).toHaveBeenCalledWith(heldFilter(filter), { projection: { _id: 1 }, session: undefined });
    expect(deleteMany).toHaveBeenCalledWith(filter, undefined);
    expect(result).toEqual({ acknowledged: true, deletedCount: 2 });
    expect(cancelReservationRequest.mock.calls).toEqual([[a.toHexString()], [b.toHexString()]]);
  });

  it("cancels nothing when no deleted task had a request or a hold", async () => {
    await TasksRepository.delete({ _id: new ObjectId() });

    expect(deleteMany).toHaveBeenCalledOnce();
    expect(cancelReservationRequest).not.toHaveBeenCalled();
  });

  it("skips the lookup for a filter that names another task type", async () => {
    await TasksRepository.delete({ task: "STOP", deploymentId: "dep-1" });

    expect(find).not.toHaveBeenCalled();
    expect(deleteMany).toHaveBeenCalledOnce();
  });

  it("does not wait on host-manager, and a failed cancel is only logged", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    find.mockResolvedValue([{ _id: new ObjectId() }]);
    cancelReservationRequest.mockRejectedValue(new Error("host-manager down"));

    await expect(TasksRepository.delete({ deploymentId: "dep-1" })).resolves.toMatchObject({ deletedCount: 2 });
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
  });

  it("looks up and deletes in the caller's session", async () => {
    const session = { id: "s" };

    await TasksRepository.delete({ deploymentId: "dep-1" }, { session } as never);

    expect(find).toHaveBeenCalledWith(expect.anything(), { projection: { _id: 1 }, session });
    expect(deleteMany).toHaveBeenCalledWith({ deploymentId: "dep-1" }, { session });
  });
});
