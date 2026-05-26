import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Db } from "mongodb";

import { createCollections } from "./collections/index.js";
import { shouldRunWorker, type AppMode } from "../../config/mode.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const POLL_INTERVAL_MS = 2_000;
export const DEFAULT_AWAIT_MAX_ATTEMPTS = 30;

export type MigrationLoader = (db: Db, name: string) => Promise<void>;

const defaultLoader: MigrationLoader = async (db, name) => {
  const migrationModule = await import(`./migrations/${name}`);
  await migrationModule.default(db);
};

export function listExpectedMigrations(): string[] {
  return fs
    .readdirSync(`${__dirname}/migrations`)
    .filter((file) => file.endsWith(".js"))
    .sort((a, b) => Number(a.split("-")[0]) - Number(b.split("-")[0]));
}

export async function runPendingMigrations(
  db: Db,
  expected: string[] = listExpectedMigrations(),
  load: MigrationLoader = defaultLoader,
): Promise<void> {
  for (const migration of expected) {
    const applied = await db.collection("_migrations").findOne({ migration });
    if (applied) continue;

    console.log(`Applying migration ${migration}.`);
    await load(db, migration);
    await db
      .collection("_migrations")
      .insertOne({ migration, completed_at: new Date() });
  }
}

export async function awaitMigrationsApplied(
  db: Db,
  options: { maxAttempts?: number; expected?: string[] } = {},
): Promise<void> {
  const expected = options.expected ?? listExpectedMigrations();
  const maxAttempts = options.maxAttempts ?? DEFAULT_AWAIT_MAX_ATTEMPTS;
  let lastLogged = -1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const applied = await db
      .collection("_migrations")
      .find(
        { migration: { $in: expected } },
        { projection: { migration: 1 } },
      )
      .toArray();
    const appliedSet = new Set(applied.map((d) => d.migration as string));
    const pending = expected.filter((m) => !appliedSet.has(m));

    if (pending.length === 0) return;

    if (attempt === maxAttempts) {
      throw new Error(
        `Gave up after ${maxAttempts} attempts waiting for migrations: ${pending.join(", ")}`,
      );
    }

    if (appliedSet.size !== lastLogged) {
      console.log(
        `Waiting for migrations: ${appliedSet.size}/${expected.length} applied; pending=${pending.join(", ")} (attempt ${attempt}/${maxAttempts})`,
      );
      lastLogged = appliedSet.size;
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

export async function init_db(db: Db, mode: AppMode): Promise<void> {
  await createCollections(db);

  if (shouldRunWorker(mode)) {
    await runPendingMigrations(db);
  } else {
    await awaitMigrationsApplied(db);
  }
}
