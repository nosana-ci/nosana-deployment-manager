import { Db } from "mongodb";

import { CollectionsNames } from "../../../definitions/collection.js";

export async function createCollections(db: Db) {
  console.log("Creating collection schemas.");
  try {
    const collections = await db.listCollections().toArray();

    for (const collection of CollectionsNames) {
      if (!collections.find(({ name }) => name === collection)) {
        await db.createCollection(collection);
      }
    }

    if (!collections.find(({ name }) => name === "_migrations")) {
      await db.createCollection("_migrations");
    }
  } catch (error) {
    console.error("Error creating collection schemas.");
    throw error;
  }
}
