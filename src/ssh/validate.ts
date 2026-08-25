import type { JobDefinition } from "@nosana/kit";

/**
 * Mirrors the node's acceptance rules for `ssh.public_keys` (see the node's
 * `sshGateway.ts`). The node silently drops the ENTIRE key set when a cap is
 * exceeded, so rejecting up front is the only way the user finds out.
 */
export const MAX_SSH_PUBLIC_KEYS = 10;
const MAX_SSH_PUBLIC_KEY_LINE_LENGTH = 8192;
const MAX_SSH_PUBLIC_KEYS_BYTES = 64 * 1024;
const SSH_PUBLIC_KEY_ALGORITHMS = new Set([
  "ssh-ed25519",
  "ssh-rsa",
  "ecdsa-sha2-nistp256",
  "ecdsa-sha2-nistp384",
  "ecdsa-sha2-nistp521",
  "sk-ssh-ed25519@openssh.com",
  "sk-ecdsa-sha2-nistp256@openssh.com",
]);

/**
 * A plain OpenSSH public-key line: `<algorithm> <base64 blob> [comment]`, whose
 * blob decodes to a key whose embedded algorithm matches the prefix. NOT a full
 * `authorized_keys` entry — the node adds its own options.
 */
export function isSshPublicKey(key: string): boolean {
  if (!key || key.length > MAX_SSH_PUBLIC_KEY_LINE_LENGTH) return false;

  const parts = key.split(/\s+/);
  if (parts.length < 2 || parts.length > 3) return false;

  const [algorithm, encodedKey, comment] = parts;
  if (!SSH_PUBLIC_KEY_ALGORITHMS.has(algorithm)) return false;
  if (comment && /[\r\n]/.test(comment)) return false;

  const decoded = Buffer.from(encodedKey, "base64");
  if (decoded.length === 0 || decoded.toString("base64") !== encodedKey) return false;

  // First SSH string of the blob is the algorithm name; it must match the prefix
  // and be followed by key material.
  if (decoded.length < 4) return false;
  const length = decoded.readUInt32BE(0);
  const end = 4 + length;
  if (length === 0 || end > decoded.length) return false;
  if (decoded.toString("ascii", 4, end) !== algorithm) return false;

  return end < decoded.length;
}

/**
 * Validate a full key set as the node would accept it. Returns a human-readable
 * reason on failure, `null` when the set is acceptable. An empty set is valid:
 * it revokes SSH access.
 */
export function validateSshPublicKeys(keys: string[]): string | null {
  if (keys.length > MAX_SSH_PUBLIC_KEYS) {
    return `At most ${MAX_SSH_PUBLIC_KEYS} SSH public keys are allowed.`;
  }

  const seen = new Set<string>();
  let totalBytes = 0;
  for (const [index, key] of keys.entries()) {
    if (!isSshPublicKey(key)) {
      return `public_keys[${index}] is not a valid OpenSSH public key (expected "<algorithm> <base64> [comment]").`;
    }
    if (seen.has(key)) {
      return `public_keys[${index}] is a duplicate.`;
    }
    seen.add(key);
    totalBytes += Buffer.byteLength(key);
  }

  if (totalBytes > MAX_SSH_PUBLIC_KEYS_BYTES) {
    return `SSH public keys exceed ${MAX_SSH_PUBLIC_KEYS_BYTES} bytes in total.`;
  }

  return null;
}

/**
 * Validate the `ssh` block of a submitted job definition with the same rules
 * as the dedicated update route, so an unacceptable set can't reach the
 * deployment through any entry point (the kit's definition validator only
 * checks that `public_keys` is an array of strings). Absent block = nothing
 * to check.
 */
export function validateJobDefinitionSshKeys(jobDefinition: JobDefinition): string | null {
  const keys = jobDefinition.ssh?.public_keys;
  if (!keys) return null;
  return validateSshPublicKeys(keys.map((key) => key.trim()));
}
