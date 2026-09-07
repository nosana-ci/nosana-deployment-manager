import {
  getSshPublicKeys,
  isValidSshPublicKey,
  MAX_SSH_PUBLIC_KEYS,
  MAX_SSH_PUBLIC_KEYS_BYTES,
  requireSshPublicKeySet,
} from "@nosana/kit";

import { messageOf } from "../tasks/idempotency/errorInfo.js";

import type { JobDefinition } from "@nosana/kit";

export { MAX_SSH_PUBLIC_KEYS, MAX_SSH_PUBLIC_KEYS_BYTES };

/**
 * Validate a full key set with the rules the node, the kit and this service
 * share through `@nosana/ssh`: every line a real OpenSSH public key, keys that
 * differ only by comment collapsed to one, and the node's count and size caps.
 * Returns a human-readable reason on failure, `null` when the set is
 * acceptable. An empty set is valid: it revokes access.
 */
export function validateSshPublicKeys(keys: string[]): string | null {
  const invalid = keys.findIndex((key) => !isValidSshPublicKey(key));
  if (invalid !== -1) {
    return `public_keys[${invalid}] is not a valid OpenSSH public key (expected "<algorithm> <base64> [comment]").`;
  }

  try {
    requireSshPublicKeySet(keys);
    return null;
  } catch (error) {
    return messageOf(error);
  }
}

/**
 * Validate the `ssh` block of a submitted job definition with the same rules
 * as the dedicated key routes, so an unacceptable set can't reach the
 * deployment through any entry point (the kit's definition validator only
 * checks that `public_keys` is an array of strings). Absent block = nothing
 * to check.
 */
export function validateJobDefinitionSshKeys(jobDefinition: JobDefinition): string | null {
  if (!jobDefinition.ssh?.public_keys) return null;
  return validateSshPublicKeys(getSshPublicKeys(jobDefinition).map((key) => key.trim()));
}
