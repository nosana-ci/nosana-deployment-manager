import { getSshPublicKeys, withSshPublicKeys } from "@nosana/kit";

import type { JobDefinition } from "@nosana/kit";

/**
 * Split the `ssh` block off a submitted job definition. Revisions store (and
 * pin) the definition WITHOUT it — the keys live on the deployment — so that a
 * key rotation never creates a revision. `public_keys` is returned only when
 * the body actually carried keys; an absent/empty block means "leave the
 * deployment's keys as they are", not "clear them".
 */
export function extractSsh(jobDefinition: JobDefinition): {
  jobDefinition: JobDefinition;
  public_keys?: string[];
} {
  const public_keys = getSshPublicKeys(jobDefinition).map((key) => key.trim());

  return {
    jobDefinition: stripSsh(jobDefinition),
    ...(public_keys.length > 0 ? { public_keys } : {}),
  };
}

/** The definition with any `ssh` block removed (no-op when there is none). */
export function stripSsh(jobDefinition: JobDefinition): JobDefinition {
  return withSshPublicKeys(jobDefinition, []);
}

/**
 * The definition a job is posted with: the revision's definition plus the
 * deployment's CURRENT keys. Without keys the stored definition is returned
 * untouched, so a deployment that never used SSH pins exactly what it always did.
 */
export function injectSsh(jobDefinition: JobDefinition, public_keys: string[] | undefined): JobDefinition {
  return withSshPublicKeys(jobDefinition, public_keys ?? []);
}
