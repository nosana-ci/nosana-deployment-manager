import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";

import type { OutstandingTasksDocument } from "../../../types/index.js";

const reconcileUnits = vi.fn();
const checkTaskWanted = vi.fn();
const deploymentsUpdateOne = vi.fn();

vi.mock("../../execution/orchestrate/index.js", () => ({
  reconcileUnits: (...a: unknown[]) => reconcileUnits(...a),
}));
vi.mock("../../queue/wanted/index.js", () => ({
  checkTaskWanted: (...a: unknown[]) => checkTaskWanted(...a),
}));
vi.mock("../../../worker/Worker.js", () => ({ VaultWorker: vi.fn() }));
vi.mock("../../../repositories/index.js", () => ({
  getRepository: () => ({ collection: { updateOne: (...a: unknown[]) => deploymentsUpdateOne(...a) } }),
}));

import { VaultWorker } from "../../../worker/Worker.js";
import { runExtendTask } from "./run.js";

const db = {} as Db;

const task = {
  _id: new ObjectId(),
  task: "EXTEND",
  deploymentId: "dep-1",
  job: "job-1",
  inflight_retries: 2,
  deployment: { vault: { vault_key: "k" }, owner: "o" },
} as unknown as OutstandingTasksDocument;

beforeEach(() => {
  reconcileUnits.mockReset().mockImplementation(async ({ makeWorker }: { makeWorker: (c: number, s: number) => unknown }) => {
    await makeWorker(1, 0);
    return { confirmed: 0, errored: 0, aborted: false, retry: false };
  });
  checkTaskWanted.mockReset();
  deploymentsUpdateOne.mockReset().mockResolvedValue({});
  vi.mocked(VaultWorker).mockClear();
});

describe("runExtendTask", () => {
  it("is judged again right before it signs, and signs nothing once no longer wanted", async () => {
    checkTaskWanted.mockResolvedValue(false);

    const result = await runExtendTask(db, task, new AbortController().signal);

    expect(checkTaskWanted).toHaveBeenCalledWith(task);
    expect(VaultWorker).not.toHaveBeenCalled();
    expect(result).toEqual({ outcome: "COMPLETED", successCount: 0 });
    expect(deploymentsUpdateOne).not.toHaveBeenCalled(); // no retry state touched
  });

  it("signs while still wanted", async () => {
    checkTaskWanted.mockResolvedValue(true);

    await runExtendTask(db, task, new AbortController().signal);

    expect(VaultWorker).toHaveBeenCalledOnce();
  });
});
