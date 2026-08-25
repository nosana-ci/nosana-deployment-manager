import { getConfig } from "../../../config/index.js";

import type { OutstandingTasksDocument } from "../../../types/index.js";

/**
 * The IPFS hash a LIST task posts — the confidential placeholder pin, or the
 * active revision's own `ipfs_definition_hash`, which the write paths keep
 * ready (the deployment's SSH keys are already merged into it when set).
 *
 * The caller freezes the result on the task (`ipfs_definition_hash`, alongside
 * `target_count`): a key rotation re-pins the active revision's hash in place,
 * and a reclaimed task must re-post the identical payload (the API batch
 * path's idempotency key demands it) with every slot on the same definition.
 */
export function resolveListDefinitionHash(task: OutstandingTasksDocument): string {
  const { confidential, active_revision } = task.deployment;

  if (confidential) return getConfig().confidential_ipfs_pin;

  const activeRevision = task.revisions.find(({ revision }) => revision === active_revision);
  if (!activeRevision) throw new Error("Active revision not found");

  return activeRevision.ipfs_definition_hash;
}
