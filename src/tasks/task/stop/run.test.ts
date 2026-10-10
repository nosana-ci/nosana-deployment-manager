import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";

import type { OutstandingTasksDocument } from "../../../types/index.js";

const orchestrateUnits = vi.fn();
const scheduleTask = vi.fn();
const deleteTasks = vi.fn();
const tasksUpdateOne = vi.fn();
const tasksFindOne = vi.fn();
const jobsCountDocuments = vi.fn();
const jobsUpdateMany = vi.fn();

vi.mock("../../execution/orchestrate/index.js", () => ({
  orchestrateUnits: (...a: unknown[]) => orchestrateUnits(...a),
}));
vi.mock("../../scheduleTask.js", () => ({ scheduleTask: (...a: unknown[]) => scheduleTask(...a) }));
vi.mock("../../../worker/Worker.js", () => ({ VaultWorker: vi.fn() }));
vi.mock("../../../repositories/index.js", () => ({
  getRepository: (name: string) => ({
    delete: (...a: unknown[]) => deleteTasks(...a),
    collection:
      name === "jobs"
        ? {
            countDocuments: (...a: unknown[]) => jobsCountDocuments(...a),
            updateMany: (...a: unknown[]) => jobsUpdateMany(...a),
          }
        : name === "tasks"
          ? { updateOne: (...a: unknown[]) => tasksUpdateOne(...a), findOne: (...a: unknown[]) => tasksFindOne(...a) }
          : { updateOne: vi.fn(async () => ({})), insertOne: vi.fn(async () => ({})) },
  }),
}));

import { LIST_IN_FLIGHT } from "../../queue/wanted/index.js";
import { runStopTask } from "./run.js";

const db = {} as Db;
const signal = () => new AbortController().signal;

const job = (address: string, revision: number) => ({
  job: address,
  revision,
  state: "RUNNING",
  updated_at: new Date(0),
});

function makeTask(over: Record<string, unknown> = {}): OutstandingTasksDocument {
  return {
    _id: new ObjectId(),
    task: "STOP",
    deploymentId: "dep-1",
    jobs: [job("old-1", 1), job("old-2", 1), job("new-1", 2)],
    deployment: { status: "RUNNING", active_revision: 2, owner: "o", vault: { vault_key: "k" } },
    ...over,
  } as unknown as OutstandingTasksDocument;
}

beforeEach(() => {
  orchestrateUnits.mockReset().mockResolvedValue({ confirmed: 0, errored: 0, aborted: false, retry: false });
  scheduleTask.mockReset().mockResolvedValue(true);
  deleteTasks.mockReset().mockResolvedValue({ deletedCount: 0 });
  tasksUpdateOne.mockReset().mockResolvedValue({});
  tasksFindOne.mockReset().mockResolvedValue(null);
  jobsCountDocuments.mockReset().mockResolvedValue(0);
  jobsUpdateMany.mockReset().mockResolvedValue({});
});

describe("runStopTask: revision stop", () => {
  it("retires every other revision's jobs and leaves the deployment's other tasks alone", async () => {
    const task = makeTask({ active_revision: 2 });

    await runStopTask(db, task, signal());

    expect(tasksUpdateOne).toHaveBeenCalledWith({ _id: task._id }, { $set: { stop_targets: ["old-1", "old-2"] } });
    expect(deleteTasks).not.toHaveBeenCalled(); // a superseded LIST is dropped when due, not swept
  });

  it("never counts the new revision's jobs as stragglers, nor escalates to a full stop", async () => {
    const task = makeTask({ active_revision: 2 });

    await runStopTask(db, task, signal());

    expect(jobsCountDocuments).toHaveBeenCalledWith({
      deployment: "dep-1",
      state: { $in: ["QUEUED", "RUNNING"] },
      job: { $nin: ["old-1", "old-2"] },
      revision: { $ne: 2 },
    });
    expect(scheduleTask).not.toHaveBeenCalled();
  });

  it("re-runs itself, still scoped to its revision, for an older-revision job recorded after it froze", async () => {
    jobsCountDocuments.mockResolvedValue(1);
    const task = makeTask({ active_revision: 2 });

    await runStopTask(db, task, signal());

    expect(scheduleTask).toHaveBeenCalledWith(db, "STOP", "dep-1", "RUNNING", expect.any(Date), {
      active_revision: 2,
      reason: "revision",
      idempotent: true,
    });
  });

  it("waits for an older revision's LIST still in flight, re-running once it is due", async () => {
    const due_at = new Date(Date.now() + 30_000);
    tasksFindOne.mockResolvedValue({ due_at });
    const task = makeTask({ active_revision: 2 });

    await runStopTask(db, task, signal());

    expect(tasksFindOne).toHaveBeenCalledWith(
      { deploymentId: "dep-1", $or: LIST_IN_FLIGHT, active_revision: { $ne: 2 } },
      { sort: { due_at: 1 }, projection: { due_at: 1 } }
    );
    expect(scheduleTask).toHaveBeenCalledWith(db, "STOP", "dep-1", "RUNNING", due_at, {
      active_revision: 2,
      reason: "revision",
      idempotent: true,
    });
  });
});

describe("runStopTask: full stop", () => {
  it("drops the deployment's other pending tasks, sparing a LIST in flight", async () => {
    await runStopTask(db, makeTask({ deployment: { status: "STOPPING", active_revision: 2, vault: { vault_key: "k" } } }), signal());

    expect(deleteTasks).toHaveBeenCalledWith({ deploymentId: "dep-1", task: { $ne: "STOP" }, $nor: LIST_IN_FLIGHT });
  });

  it("re-runs for stragglers across every revision", async () => {
    jobsCountDocuments.mockResolvedValue(1);

    await runStopTask(db, makeTask(), signal());

    expect(jobsCountDocuments).toHaveBeenCalledWith(expect.not.objectContaining({ revision: expect.anything() }));
    expect(scheduleTask).toHaveBeenCalledWith(db, "STOP", "dep-1", "RUNNING", expect.any(Date), {
      active_revision: undefined,
      reason: "stop",
      idempotent: true,
    });
  });

  it("marks what it stopped STOPPED, unless the job already settled on its own", async () => {
    orchestrateUnits.mockImplementation(async ({ handlers }: { handlers: { onConfirmed: (u: number, s: string, j: string) => void } }) => {
      handlers.onConfirmed(0, "sig", "old-1");
      return { confirmed: 1, errored: 0, aborted: false, retry: false };
    });

    await runStopTask(db, makeTask({ active_revision: 2 }), signal());

    expect(jobsUpdateMany).toHaveBeenCalledWith(
      { job: { $in: ["old-1"] }, state: { $in: ["QUEUED", "RUNNING"] } },
      { $set: { state: "STOPPED", updated_at: expect.any(Date) } }
    );
  });
});

describe("runStopTask: targeted and trimming stops", () => {
  it.each([{ job: "old-1" }, { limit: 1 }])("neither sweeps tasks nor self-heals: %o", async (scope) => {
    jobsCountDocuments.mockResolvedValue(3);

    await runStopTask(db, makeTask(scope), signal());

    expect(deleteTasks).not.toHaveBeenCalled();
    expect(scheduleTask).not.toHaveBeenCalled();
  });
});
