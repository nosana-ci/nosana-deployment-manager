import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Db } from "mongodb";

import { createCollections } from "./collections/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function init_db(db: Db, use_tls: boolean = false) {
  if (use_tls) {
    try {
      await db.admin().command({
        modifyChangeStreams: 1,
        database: "",
        collection: "",
        enable: true,
      });
    } catch (error) {
      console.error("Error enabling change streams");
      throw error;
    }

    console.log("Change streams enabled successfully.");
  }

  await createCollections(db);

  const migrations = fs
    .readdirSync(`${__dirname}/migrations`)
    .filter((file) => file.endsWith(".js"));

  for (const migration of migrations) {
    const applied = await db.collection("migrations").findOne({ migration });

    if (!applied) {
      console.log(`Applying migration ${migration}.`);
      const migrationModule = await import(`./migrations/${migration}`);

      await migrationModule.default(db);
      await db
        .collection("_migrations")
        .insertOne({ migration, completed_at: new Date() });
    }
  }
}
