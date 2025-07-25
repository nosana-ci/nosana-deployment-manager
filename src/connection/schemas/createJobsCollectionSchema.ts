import { Db } from "mongodb";

export async function createJobsCollectionSchema(
  db: Db,
  collectionExists: boolean
) {
  if (!collectionExists) {
    await db.createCollection("jobs");
  }

  await db.command({
    collMod: "jobs",
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["tx", "job", "deployment", "created_at"],
        properties: {
          tx: {
            bsonType: "string",
            description: "Solana transaction id of job list.",
          },
          job: {
            bsonType: "string",
            description: "Solana job account address.",
          },
          deployment: {
            bsonType: "string",
            description: "Deployment source address.",
          },
          created_at: {
            bsonType: "date",
            description: "Creation date.",
          },
        },
      },
    },
    validationLevel: "moderate",
  });
}
