import { describe, it, expect, vi, beforeEach } from "vitest";

import { DeploymentStatus, TaskType } from "../../../types/index.js";
import type { TaskDocument, TxRecord } from "../../../types/index.js";

const findOne = vi.fn();
const count = vi.fn();
vi.mock("../../../repositories/index.js", () => ({
  getRepository: (name: string) =>
    name === "deployments" ? { collection: { findOne: (...a: unknown[]) => findOne(...a) } } : { count: (...a: unknown[]) => count(...a) },
}));

import { checkTaskWanted, isListInFlight, isTaskWanted } from "./wanted.js";

const ALL_STATUSES = Object.values(DeploymentStatus);
const RUNNING = [DeploymentStatus.STARTING, DeploymentStatus.RUNNING, DeploymentStatus.INSUFFICIENT_FUNDS];
const NOT_RUNNING = ALL_STATUSES.filter((status) => !RUNNING.includes(status));

const deployment = (status: DeploymentStatus, active_revision = 2) => ({ status, active_revision });

describe("isTaskWanted", () => {
  describe("LIST", () => {
    it.each(RUNNING)("is wanted for its active revision while %s", (status) => {
      expect(isTaskWanted({ task: TaskType.LIST, active_revision: 2 }, deployment(status), true)).toBe(true);
    });

    it.each(NOT_RUNNING)("is not wanted while %s, whatever the revision", (status) => {
      expect(isTaskWanted({ task: TaskType.LIST, active_revision: 2 }, deployment(status), true)).toBe(false);
    });

    it.each(RUNNING)("is not wanted once its revision is superseded, even while %s", (status) => {
      expect(isTaskWanted({ task: TaskType.LIST, active_revision: 1 }, deployment(status), true)).toBe(false);
      expect(isTaskWanted({ task: TaskType.LIST, active_revision: 3 }, deployment(status), true)).toBe(false);
    });

    it("counts a LIST queued before revisions were frozen on tasks as the active revision", () => {
      expect(isTaskWanted({ task: TaskType.LIST }, deployment(DeploymentStatus.RUNNING), true)).toBe(true);
    });

    it("is wanted in the run it was scheduled in", () => {
      const running = { ...deployment(DeploymentStatus.RUNNING), run: 4 };
      expect(isTaskWanted({ task: TaskType.LIST, active_revision: 2, run: 4 }, running, true)).toBe(true);
    });

    it("is never wanted again after a stop and restart: an older run cannot top back up", () => {
      const restarted = { ...deployment(DeploymentStatus.RUNNING), run: 5 };
      expect(isTaskWanted({ task: TaskType.LIST, active_revision: 2, run: 4 }, restarted, true)).toBe(false);
    });

    it("counts a run missing on either side (from before runs were counted) as the current run", () => {
      expect(isTaskWanted({ task: TaskType.LIST, active_revision: 2 }, { ...deployment(DeploymentStatus.RUNNING), run: 5 }, true)).toBe(true);
      expect(isTaskWanted({ task: TaskType.LIST, active_revision: 2, run: 4 }, deployment(DeploymentStatus.RUNNING), true)).toBe(true);
    });
  });

  describe("EXTEND", () => {
    it.each(RUNNING)("is wanted while %s and its job is active", (status) => {
      expect(isTaskWanted({ task: TaskType.EXTEND }, deployment(status), true)).toBe(true);
    });

    it.each(RUNNING)("is not wanted while %s once its job has settled", (status) => {
      expect(isTaskWanted({ task: TaskType.EXTEND }, deployment(status), false)).toBe(false);
    });

    it.each(NOT_RUNNING)("is not wanted while %s", (status) => {
      expect(isTaskWanted({ task: TaskType.EXTEND }, deployment(status), true)).toBe(false);
    });

    it("keeps its job alive across a restart that kept the job (no stop in between)", () => {
      expect(isTaskWanted({ task: TaskType.EXTEND, run: 4 }, { ...deployment(DeploymentStatus.RUNNING), run: 5 }, true)).toBe(true);
    });
  });

  describe("STOP", () => {
    it.each(ALL_STATUSES)("a stop without a revision (full, targeted, trimming) is always wanted: %s", (status) => {
      expect(isTaskWanted({ task: TaskType.STOP }, deployment(status), false)).toBe(true);
    });

    it.each(ALL_STATUSES)("a revision stop is wanted while its revision is active: %s", (status) => {
      expect(isTaskWanted({ task: TaskType.STOP, active_revision: 2 }, deployment(status), false)).toBe(true);
    });

    it("stops whichever run it was scheduled in", () => {
      expect(isTaskWanted({ task: TaskType.STOP, run: 4 }, { ...deployment(DeploymentStatus.STOPPING), run: 5 }, false)).toBe(true);
    });

    it.each(ALL_STATUSES)("a superseded revision stop is not: %s", (status) => {
      expect(isTaskWanted({ task: TaskType.STOP, active_revision: 1 }, deployment(status), false)).toBe(false);
    });
  });
});

describe("isListInFlight", () => {
  const record = (over: Partial<TxRecord>): TxRecord => ({
    unit: 0,
    signature: "sig",
    lastValidBlockHeight: 1,
    status: "SIGNED",
    ...over,
  });
  const task = (over: Partial<TaskDocument>): TaskDocument => ({
    task: TaskType.LIST,
    due_at: new Date(),
    deploymentId: "dep-1",
    tx: null,
    created_at: new Date(),
    status: "PENDING",
    attempts: 0,
    ...over,
  });

  it("holds a transaction that still carries its signed bytes", () => {
    expect(isListInFlight(task({ transactions: [record({ status: "SIGNED", blob: "AAAA" })] }))).toBe(true);
  });

  it("holds an API batch it posted", () => {
    expect(isListInFlight(task({ assign_posted_at: new Date() }))).toBe(true);
  });

  it("does not once every transaction confirmed or provably expired", () => {
    const transactions = [record({ status: "CONFIRMED", blob: null }), record({ unit: 1, status: "SENT", blob: null })];
    expect(isListInFlight(task({ transactions }))).toBe(false);
    expect(isListInFlight(task({}))).toBe(false);
  });

  it("is never true of a STOP or EXTEND: what they change is tracked on-chain", () => {
    const transactions = [record({ blob: "AAAA" })];
    expect(isListInFlight(task({ task: TaskType.STOP, transactions }))).toBe(false);
    expect(isListInFlight(task({ task: TaskType.EXTEND, transactions }))).toBe(false);
  });
});

describe("checkTaskWanted", () => {
  beforeEach(() => {
    findOne.mockReset();
    count.mockReset();
  });

  const base = { due_at: new Date(), deploymentId: "dep-1", tx: null, created_at: new Date(), status: "PENDING", attempts: 0 } as const;

  it("judges against the deployment as stored now", async () => {
    findOne.mockResolvedValue(deployment(DeploymentStatus.STOPPING));

    await expect(checkTaskWanted({ ...base, task: TaskType.LIST, active_revision: 2 })).resolves.toBe(false);
    expect(findOne).toHaveBeenCalledWith({ id: "dep-1" }, { projection: { status: 1, active_revision: 1, run: 1 } });
    expect(count).not.toHaveBeenCalled();
  });

  it("is not wanted once the deployment is gone", async () => {
    findOne.mockResolvedValue(null);

    await expect(checkTaskWanted({ ...base, task: TaskType.STOP })).resolves.toBe(false);
  });

  it("looks up an EXTEND's job", async () => {
    findOne.mockResolvedValue(deployment(DeploymentStatus.RUNNING));
    count.mockResolvedValue(0);

    await expect(checkTaskWanted({ ...base, task: TaskType.EXTEND, job: "job-1" })).resolves.toBe(false);
    expect(count).toHaveBeenCalledWith({ job: "job-1", state: { $in: ["QUEUED", "RUNNING"] } });
  });
});
