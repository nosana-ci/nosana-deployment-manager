import { getConfig } from "../../../config/index.js";

import type { OutstandingTasksDocument } from "../../../types/index.js";

/**
 * The IPFS hash a LIST task posts — the confidential placeholder pin, or the
 * own `ipfs_definition_hash` of the revision the task lists (the active one
 * when it runs: the task is dropped once a swap supersedes it), which the
 * write paths keep ready (the deployment's SSH keys are already merged into it when set).
 *
 * The caller freezes the result on the task (`ipfs_definition_hash`, alongside
 * `target_count`): a key rotation re-pins the active revision's hash in place,
 * and a reclaimed task must re-post the identical payload (the API batch
 * path's idempotency key demands it) with every slot on the same definition.
 */
export function resolveListDefinitionHash(task: OutstandingTasksDocument): string {
  const { confidential, active_revision } = task.deployment;

  if (confidential) return getConfig().confidential_ipfs_pin;

  const listed = task.active_revision ?? active_revision;
  const revision = task.revisions.find(({ revision }) => revision === listed);
  if (!revision) throw new Error("Active revision not found");

  return revision.ipfs_definition_hash;
}
