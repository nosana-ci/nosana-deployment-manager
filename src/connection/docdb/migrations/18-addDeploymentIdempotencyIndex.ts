import type { Db } from "mongodb";

export default async function addDeploymentIdempotencyIndex(db: Db) {
  await db.collection("deployments").createIndex(
    { owner: 1, idempotency_key: 1 },
    {
      name: "idx_owner_idempotency_key",
      unique: true,
      partialFilterExpression: { idempotency_key: { $exists: true } },
    },
  );
}
