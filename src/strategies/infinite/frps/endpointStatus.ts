import { FrpsEndpointStatusRepository } from "../../../repositories/index.js";

import type { FrpsEndpointState, FrpsTunnelReason } from "../../../types/index.js";

type RecordEndpointStateArgs = {
  job: string;
  opId: string;
  deploymentId: string | undefined;
  state: FrpsEndpointState;
  /** Set only when `state` is `down`. */
  reason?: FrpsTunnelReason;
};

/**
 * Upserts the tunnel status for one `(job, opId)`, keeping `last_change` accurate
 * — it only moves when the state actually flips, not on every repeat of the same
 * state. Idempotent, so replaying the stream re-applies cleanly.
 */
export async function recordEndpointState({
  job,
  opId,
  deploymentId,
  state,
  reason,
}: RecordEndpointStateArgs): Promise<void> {
  const collection = FrpsEndpointStatusRepository.collection;
  const now = new Date();

  const set: Record<string, unknown> = { deploymentId, state, updated_at: now };
  const update: Record<string, unknown> = { $set: set };
  if (reason) {
    set.reason = reason;
  } else {
    update.$unset = { reason: "" };
  }

  // A real transition: stamp last_change. Matches only when the stored state
  // differs, so a repeated same-state event leaves last_change untouched.
  const transition = await collection.updateOne(
    { job, opId, state: { $ne: state } },
    { ...update, $set: { ...set, last_change: now } },
  );

  if (transition.matchedCount > 0) return;

  // No transition — either the state is unchanged or the doc doesn't exist yet.
  // Ensure it exists and refresh updated_at; last_change is set only on insert.
  await collection.updateOne(
    { job, opId },
    { ...update, $setOnInsert: { last_change: now } },
    { upsert: true },
  );
}
