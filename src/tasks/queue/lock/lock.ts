import { getRepository } from "../../../repositories/index.js";
import type { DeploymentLocksCollection } from "../../../types/index.js";

/**
 * Per-deployment advisory lock used to serialize mutating tasks for a single
 * deployment across all consumers. Without it, two consumers running (say) two
 * LIST tasks for the same deployment could each read the same job deficit and
 * overshoot `replicas` — per-tx idempotency dedupes a single task, not across
 * tasks. Backed by the `task_locks` collection (see DeploymentLockDocument); the
 * lock carries its own lease so a crashed holder's lock is reclaimable.
 */
export function getDeploymentLocks(): DeploymentLocksCollection {
  return getRepository("task_locks").collection;
}

/** True if `holder` now owns the deployment's lock. */
export async function acquireDeploymentLock(
  locks: DeploymentLocksCollection,
  deploymentId: string,
  holder: string,
  leaseMs: number
): Promise<boolean> {
  const now = new Date();
  const expires_at = new Date(now.getTime() + leaseMs);

  try {
    const doc = await locks.findOneAndUpdate(
      { _id: deploymentId, expires_at: { $lt: now } },
      { $set: { holder, expires_at } },
      { upsert: true, returnDocument: "after" }
    );
    return doc?.holder === holder;
  } catch (error) {
    // Duplicate key => the lock doc exists and is held by someone else
    // (the filter didn't match, so upsert tried to insert a clashing _id).
    if (error instanceof Error && error.message.includes("E11000")) {
      return false;
    }
    throw error;
  }
}

export async function releaseDeploymentLock(
  locks: DeploymentLocksCollection,
  deploymentId: string,
  holder: string
): Promise<void> {
  await locks.deleteOne({ _id: deploymentId, holder });
}
