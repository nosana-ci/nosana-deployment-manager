import { describe, it, expect, vi } from "vitest";
import type { Db } from "mongodb";

import {
  runPendingMigrations,
  awaitMigrationsApplied,
  init_db,
} from "./index.js";

vi.mock("./collections/index.js", () => ({
  createCollections: vi.fn(async () => {}),
}));

type MigrationDoc = { migration: string; completed_at: Date };

function createFakeMigrationsDb(initial: MigrationDoc[] = []) {
  const store: MigrationDoc[] = [...initial];
  const findOne = vi.fn(async (filter: { migration: string }) => {
    return store.find((d) => d.migration === filter.migration) ?? null;
  });
  const insertOne = vi.fn(async (doc: MigrationDoc) => {
    store.push(doc);
    return { acknowledged: true };
  });
  const find = vi.fn((filter: { migration: { $in: string[] } }) => ({
    toArray: async () =>
      store.filter((d) => filter.migration.$in.includes(d.migration)),
  }));
  const collection = vi.fn(() => ({ findOne, insertOne, find }));
  const db = { collection } as unknown as Db;
  return { db, store, findOne, insertOne, find, collection };
}

describe("runPendingMigrations", () => {
  it("applies missing migrations in order and records each one", async () => {
    const { db, store, insertOne } = createFakeMigrationsDb();
    const load = vi.fn(async () => {});
    const expected = ["1-foo.js", "2-bar.js"];

    await runPendingMigrations(db, expected, load);

    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenNthCalledWith(1, db, "1-foo.js");
    expect(load).toHaveBeenNthCalledWith(2, db, "2-bar.js");
    expect(insertOne).toHaveBeenCalledTimes(2);
    expect(store.map((d) => d.migration)).toEqual(["1-foo.js", "2-bar.js"]);
    for (const doc of store) {
      expect(doc.completed_at).toBeInstanceOf(Date);
    }
  });

  it("skips migrations already recorded in _migrations", async () => {
    const { db, insertOne } = createFakeMigrationsDb([
      { migration: "1-foo.js", completed_at: new Date() },
    ]);
    const load = vi.fn(async () => {});

    await runPendingMigrations(db, ["1-foo.js", "2-bar.js"], load);

    expect(load).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledWith(db, "2-bar.js");
    expect(insertOne).toHaveBeenCalledOnce();
  });

  it("is a no-op when every expected migration is already applied", async () => {
    const { db, insertOne } = createFakeMigrationsDb([
      { migration: "1-foo.js", completed_at: new Date() },
      { migration: "2-bar.js", completed_at: new Date() },
    ]);
    const load = vi.fn(async () => {});

    await runPendingMigrations(db, ["1-foo.js", "2-bar.js"], load);

    expect(load).not.toHaveBeenCalled();
    expect(insertOne).not.toHaveBeenCalled();
  });
});

describe("awaitMigrationsApplied", () => {
  it("resolves immediately when every expected migration is present", async () => {
    const { db } = createFakeMigrationsDb([
      { migration: "1-foo.js", completed_at: new Date() },
      { migration: "2-bar.js", completed_at: new Date() },
    ]);

    await expect(
      awaitMigrationsApplied(db, {
        expected: ["1-foo.js", "2-bar.js"],
        maxAttempts: 5,
      }),
    ).resolves.toBeUndefined();
  });

  it("resolves after a delayed insert from another process", async () => {
    const { db, store } = createFakeMigrationsDb();

    const promise = awaitMigrationsApplied(db, {
      expected: ["1-foo.js"],
      maxAttempts: 5,
    });

    setTimeout(() => {
      store.push({ migration: "1-foo.js", completed_at: new Date() });
    }, 50);

    await expect(promise).resolves.toBeUndefined();
  });

  it("rejects with a descriptive error when the attempt budget is exhausted", async () => {
    const { db, find } = createFakeMigrationsDb();

    await expect(
      awaitMigrationsApplied(db, {
        expected: ["1-foo.js"],
        maxAttempts: 3,
      }),
    ).rejects.toThrow(/Gave up after 3 attempts waiting for migrations: 1-foo\.js/);
    expect(find).toHaveBeenCalledTimes(3);
  });

  it("returns immediately when nothing is expected", async () => {
    const { db, find } = createFakeMigrationsDb();

    await expect(
      awaitMigrationsApplied(db, { expected: [], maxAttempts: 3 }),
    ).resolves.toBeUndefined();
    // One read to confirm nothing is pending, then return.
    expect(find).toHaveBeenCalledOnce();
  });
});

describe("init_db mode dispatch", () => {
  // listExpectedMigrations() reads .js files from the migrations dir relative
  // to the compiled file; under vitest the source dir has .ts files only, so
  // the default expected list is empty and both branches short-circuit. We
  // assert which branch executed by which collection method is called.

  it("in worker mode, takes the runPendingMigrations path", async () => {
    const { db, find, insertOne } = createFakeMigrationsDb();

    await init_db(db, "worker");

    // runPendingMigrations iterates expected (empty) and never queries via
    // find({$in: ...}); awaitMigrationsApplied always issues at least one find.
    expect(find).not.toHaveBeenCalled();
    expect(insertOne).not.toHaveBeenCalled();
  });

  it("in api mode, takes the awaitMigrationsApplied path", async () => {
    const { db, find, insertOne } = createFakeMigrationsDb();

    await init_db(db, "api");

    expect(find).toHaveBeenCalled();
    expect(insertOne).not.toHaveBeenCalled();
  });

  it("in all mode, takes the runPendingMigrations path", async () => {
    const { db, find, insertOne } = createFakeMigrationsDb();

    await init_db(db, "all");

    expect(find).not.toHaveBeenCalled();
    expect(insertOne).not.toHaveBeenCalled();
  });
});
