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
  const { ssh, ...rest } = jobDefinition;
  const public_keys = ssh?.public_keys?.map((key) => key.trim()).filter(Boolean);

  return {
    jobDefinition: rest,
    ...(public_keys && public_keys.length > 0 ? { public_keys } : {}),
  };
}

/** The definition with any `ssh` block removed (no-op when there is none). */
export function stripSsh(jobDefinition: JobDefinition): JobDefinition {
  return extractSsh(jobDefinition).jobDefinition;
}

/**
 * The definition a job is posted with: the revision's definition plus the
 * deployment's CURRENT keys. Without keys the stored definition is returned
 * untouched, so a deployment that never used SSH pins exactly what it always did.
 */
export function injectSsh(jobDefinition: JobDefinition, public_keys: string[] | undefined): JobDefinition {
  const base = stripSsh(jobDefinition);
  if (!public_keys || public_keys.length === 0) return base;
  return { ...base, ssh: { public_keys: [...public_keys] } };
}
