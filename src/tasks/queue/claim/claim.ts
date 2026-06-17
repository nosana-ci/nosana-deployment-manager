import { Collection, WithId } from "mongodb";

import { TaskDocument, TaskStatus } from "../../../types/index.js";

/**
 * Atomically claim up to `count` due tasks for this consumer.
 *
 * Each claim is a single `findOneAndUpdate` that flips a claimable task to
 * PROCESSING and stamps a lease — atomic, so concurrent consumers (multiple
 * replicas) can never claim the same task. A task is claimable when it is due
 * and either PENDING, missing a status (pre-migration safety), or PROCESSING
 * with an expired lease (its previous owner crashed → reclaim).
 *
 * Returns the raw claimed documents; the caller enforces the crash-loop cap on
 * `attempts` and enriches the survivors via {@link enrichClaimedTasks}.
 */
export async function claimTasks(
  collection: Collection<TaskDocument>,
  consumerId: string,
  count: number,
  leaseMs: number
): Promise<WithId<TaskDocument>[]> {
  const claimed: WithId<TaskDocument>[] = [];

  for (let i = 0; i < count; i++) {
    const now = new Date();
    const doc = await collection.findOneAndUpdate(
      {
        due_at: { $lte: now },
        $or: [
          { status: TaskStatus.PENDING },
          { status: { $exists: false } },
          { status: TaskStatus.PROCESSING, lease_expires_at: { $lt: now } },
        ],
      },
      {
        $set: {
          status: TaskStatus.PROCESSING,
          claimed_by: consumerId,
          lease_expires_at: new Date(now.getTime() + leaseMs),
        },
      },
      { sort: { due_at: 1 }, returnDocument: "after" }
    );

    if (!doc) break;
    claimed.push(doc);
  }

  return claimed;
}
