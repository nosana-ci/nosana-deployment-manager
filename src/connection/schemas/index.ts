import { Db } from "mongodb";
import { createEventsCollectionSchema } from "./createEventsCollectionSchema.js";
import { createJobsCollectionSchema } from "./createJobsCollectionSchema.js";

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

  try {
    const collections = await db.listCollections().toArray();
    const collectionName = collections.map(({ name }) => name);

    await createEventsCollectionSchema(db, collectionName.includes("events"));
    await createJobsCollectionSchema(db, collectionName.includes("jobs"));
  } catch (error) {
    console.error("Error creating collection schemas.");
    throw error;
  }

  console.log("Successfully created collection schemas.");
}
