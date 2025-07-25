import { Db } from "mongodb";

export async function createEventsCollectionSchema(
  db: Db,
  collectionExists: boolean
) {
  if (!collectionExists) {
    await db.createCollection("events");
  }

  await db.command({
    collMod: "events",
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["category", "deploymentId", "type", "message", "created_at"],
        properties: {
          category: {
            bsonType: "string",
            description: "Type of event.",
          },
          deploymentId: {
            bsonType: "string",
            description: "Deployment source address.",
          },
          type: {
            bsonType: "string",
            description: "Error type.",
          },
          message: {
            bsonType: "string",
            description: "Error message.",
          },
          tx: {
            bsonType: "string",
            description: "Solana transaction id of job list.",
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
