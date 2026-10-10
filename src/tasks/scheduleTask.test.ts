import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";

import { DeploymentStatus, TaskType } from "../types/index.js";

const insertOne = vi.fn();
const updateOne = vi.fn();
const deploymentsUpdateOne = vi.fn();
const deploymentsFindOne = vi.fn();

vi.mock("../repositories/index.js", () => ({
  getRepository: (name: string) => ({
    collection:
      name === "deployments"
        ? {
            updateOne: (...a: unknown[]) => deploymentsUpdateOne(...a),
            findOne: (...a: unknown[]) => deploymentsFindOne(...a),
          }
        : { insertOne: (...a: unknown[]) => insertOne(...a), updateOne: (...a: unknown[]) => updateOne(...a) },
  }),
}));

import { scheduleTask } from "./scheduleTask.js";

const db = {} as Db;

beforeEach(() => {
  insertOne.mockReset().mockResolvedValue({ acknowledged: true });
  updateOne.mockReset().mockResolvedValue({ upsertedCount: 1 });
  deploymentsUpdateOne.mockReset().mockResolvedValue({});
  deploymentsFindOne.mockReset().mockResolvedValue({ active_revision: 7, run: 3 });
});

describe("scheduleTask", () => {
  it("default: inserts unconditionally and reports a task was created", async () => {
    const created = await scheduleTask(db, TaskType.LIST, "dep-1", DeploymentStatus.RUNNING);

    expect(created).toBe(true);
    expect(insertOne).toHaveBeenCalledOnce();
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("leaves unset fields out of the document rather than storing them as null", async () => {
    await scheduleTask(db, TaskType.STOP, "dep-1", DeploymentStatus.RUNNING);

    const [doc] = insertOne.mock.calls[0];
    expect(doc).not.toHaveProperty("job");
    expect(doc).not.toHaveProperty("limit");
    expect(doc).not.toHaveProperty("active_revision");
    expect(doc).not.toHaveProperty("extend_seconds");
    expect(doc).not.toHaveProperty("run");
    expect(deploymentsFindOne).not.toHaveBeenCalled(); // only a LIST takes a revision and a run
  });

  it("a LIST without a revision lists the deployment's active one, in its current run", async () => {
    await scheduleTask(db, TaskType.LIST, "dep-1", DeploymentStatus.RUNNING, new Date(0), { limit: 1 });

    expect(deploymentsFindOne).toHaveBeenCalledWith({ id: "dep-1" }, { projection: { active_revision: 1, run: 1 } });
    expect(insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ task: TaskType.LIST, limit: 1, active_revision: 7, run: 3 })
    );
  });

  it("a LIST keeps the revision its caller names, and is stamped with the current run", async () => {
    await scheduleTask(db, TaskType.LIST, "dep-1", DeploymentStatus.RUNNING, new Date(0), { active_revision: 3 });

    expect(insertOne).toHaveBeenCalledWith(expect.objectContaining({ active_revision: 3, run: 3 }));
  });

  it("a LIST of a deployment never started since runs were counted carries no run", async () => {
    deploymentsFindOne.mockResolvedValue({ active_revision: 7 });

    await scheduleTask(db, TaskType.LIST, "dep-1", DeploymentStatus.RUNNING);

    expect(insertOne.mock.calls[0][0]).not.toHaveProperty("run");
  });

  it("idempotent: a LIST is keyed on its run too, so one from before a restart never absorbs a new need", async () => {
    await scheduleTask(db, TaskType.LIST, "dep-1", DeploymentStatus.RUNNING, new Date(0), { limit: 2, idempotent: true });

    expect(updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ task: TaskType.LIST, limit: 2, active_revision: 7, run: 3 }),
      expect.anything(),
      expect.anything()
    );
  });

  it("idempotent: upserts keyed by the whole intent (task, deployment, reason, job, limit, revision, run, PENDING) and creates when absent", async () => {
    updateOne.mockResolvedValueOnce({ upsertedCount: 1 });

    const created = await scheduleTask(
      db,
      TaskType.EXTEND,
      "dep-1",
      DeploymentStatus.RUNNING,
      new Date(0),
      { job: "job-1", idempotent: true }
    );

    expect(created).toBe(true);
    expect(insertOne).not.toHaveBeenCalled();
    expect(updateOne).toHaveBeenCalledWith(
      {
        task: TaskType.EXTEND,
        deploymentId: "dep-1",
        status: "PENDING",
        reason: { $exists: false },
        job: "job-1",
        limit: { $exists: false },
        active_revision: { $exists: false },
        run: { $exists: false },
        extend_seconds: { $exists: false },
      },
      { $setOnInsert: expect.objectContaining({ task: TaskType.EXTEND, job: "job-1" }) },
      { upsert: true }
    );
  });

  it("idempotent: a task without a job only matches one without a job (a full STOP never dedups against a targeted one)", async () => {
    await scheduleTask(db, TaskType.STOP, "dep-1", DeploymentStatus.STOPPING, new Date(0), { idempotent: true });

    expect(updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ job: { $exists: false }, limit: { $exists: false }, active_revision: { $exists: false } }),
      expect.anything(),
      expect.anything()
    );
  });

  it("idempotent: a revision swap's tasks are keyed on the revision, so a duplicate event queues nothing", async () => {
    updateOne.mockResolvedValueOnce({ upsertedCount: 0 });

    const created = await scheduleTask(db, TaskType.STOP, "dep-1", DeploymentStatus.RUNNING, new Date(0), {
      active_revision: 3,
      idempotent: true,
    });

    expect(created).toBe(false);
    expect(updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ task: TaskType.STOP, active_revision: 3 }),
      expect.anything(),
      expect.anything()
    );
  });

  it("idempotent match excludes one-shot delta extends so the chain isn't blocked by a re-alignment extend", async () => {
    updateOne.mockResolvedValueOnce({ upsertedCount: 1 });

    await scheduleTask(db, TaskType.EXTEND, "dep-1", DeploymentStatus.RUNNING, new Date(0), {
      job: "job-1",
      idempotent: true,
    });

    expect(updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ extend_seconds: { $exists: false } }),
      expect.anything(),
      expect.anything()
    );
  });

  it("a hand-off is created once per source task (implied idempotent), whatever state an earlier one is in", async () => {
    const source = new ObjectId();
    updateOne.mockResolvedValueOnce({ upsertedCount: 0 });

    const created = await scheduleTask(db, TaskType.LIST, "dep-1", DeploymentStatus.RUNNING, new Date(0), {
      limit: 2,
      job: "job-1",
      handoff_of: source,
    });

    expect(created).toBe(false);
    expect(updateOne).toHaveBeenCalledWith(
      { deploymentId: "dep-1", handoff_of: source },
      { $setOnInsert: expect.objectContaining({ task: TaskType.LIST, limit: 2, job: "job-1", handoff_of: source }) },
      { upsert: true }
    );
  });

  it("idempotent: a pending task already exists -> no insert, reports not created", async () => {
    updateOne.mockResolvedValueOnce({ upsertedCount: 0 });

    const created = await scheduleTask(
      db,
      TaskType.EXTEND,
      "dep-1",
      DeploymentStatus.RUNNING,
      new Date(0),
      { job: "job-1", idempotent: true }
    );

    expect(created).toBe(false);
  });

  it("flips a STARTING deployment to RUNNING, fenced on it still being STARTING", async () => {
    await scheduleTask(db, TaskType.LIST, "dep-1", DeploymentStatus.STARTING);

    expect(deploymentsUpdateOne).toHaveBeenCalledWith(
      { id: "dep-1", status: DeploymentStatus.STARTING },
      { $set: { status: DeploymentStatus.RUNNING } }
    );
  });

  it("does not flip a STARTING deployment to RUNNING when the idempotent insert no-ops", async () => {
    updateOne.mockResolvedValueOnce({ upsertedCount: 0 });

    await scheduleTask(db, TaskType.LIST, "dep-1", DeploymentStatus.STARTING, new Date(0), {
      idempotent: true,
    });

    expect(deploymentsUpdateOne).not.toHaveBeenCalled();
  });
});

/**
 * The tasks collection as a tiny in-memory store, matching the filters
 * `scheduleTask` writes (equality and `$exists`), so the key's behaviour is
 * checked end to end: which schedules collapse and which stay apart.
 */
describe("scheduleTask idempotency by purpose", () => {
  const store: Record<string, unknown>[] = [];
  const matches = (doc: Record<string, unknown>, filter: Record<string, unknown>) =>
    Object.entries(filter).every(([key, condition]) =>
      condition !== null && typeof condition === "object" && "$exists" in condition
        ? (doc[key] !== undefined) === condition.$exists
        : doc[key] === condition
    );

  beforeEach(() => {
    store.length = 0;
    insertOne.mockImplementation(async (doc: Record<string, unknown>) => {
      store.push(doc);
      return { acknowledged: true };
    });
    updateOne.mockImplementation(
      async (filter: Record<string, unknown>, update: { $setOnInsert: Record<string, unknown> }) => {
        if (store.some((doc) => matches(doc, filter))) return { upsertedCount: 0 };
        store.push(update.$setOnInsert);
        return { upsertedCount: 1 };
      }
    );
  });

  const lists = () => store.filter(({ task }) => task === TaskType.LIST);
  const stops = () => store.filter(({ task }) => task === TaskType.STOP);

  it("a market swap's LIST is not absorbed by a pending replica upscale of the same shape", async () => {
    await scheduleTask(db, TaskType.LIST, "dep-1", DeploymentStatus.RUNNING, undefined, { limit: 1 }); // upscale
    await scheduleTask(db, TaskType.LIST, "dep-1", DeploymentStatus.RUNNING, new Date(), {
      limit: 1,
      reason: "market",
      idempotent: true,
    });

    expect(lists()).toHaveLength(2);
  });

  it("a duplicate market event collapses into the pending market LIST", async () => {
    const market = () =>
      scheduleTask(db, TaskType.LIST, "dep-1", DeploymentStatus.RUNNING, new Date(), {
        limit: 2,
        reason: "market",
        idempotent: true,
      });

    await expect(market()).resolves.toBe(true);
    await expect(market()).resolves.toBe(false);
    expect(lists()).toHaveLength(1);
  });

  it("an over-count trim is not absorbed by a pending downscale STOP of the same shape, but collapses into itself", async () => {
    const overcount = () =>
      scheduleTask(db, TaskType.STOP, "dep-1", DeploymentStatus.RUNNING, new Date(), {
        limit: 1,
        reason: "overcount",
        idempotent: true,
      });

    await scheduleTask(db, TaskType.STOP, "dep-1", DeploymentStatus.RUNNING, new Date(), { limit: 1 }); // downscale
    await expect(overcount()).resolves.toBe(true);
    await expect(overcount()).resolves.toBe(false);

    expect(stops()).toHaveLength(2);
  });

  it("schedules again once the pending one has run (it is gone from the queue)", async () => {
    const market = () =>
      scheduleTask(db, TaskType.LIST, "dep-1", DeploymentStatus.RUNNING, new Date(), {
        limit: 1,
        reason: "market",
        idempotent: true,
      });

    await market();
    store.length = 0; // the LIST ran and was deleted
    await expect(market()).resolves.toBe(true);
  });

  it("a job-keyed task needs no reason: a startup deadline and an unhealthy-tunnel stop of one job still collapse", async () => {
    const stopJob = () =>
      scheduleTask(db, TaskType.STOP, "dep-1", DeploymentStatus.RUNNING, new Date(), { job: "job-1", idempotent: true });

    await expect(stopJob()).resolves.toBe(true);
    await expect(stopJob()).resolves.toBe(false);
  });
});
