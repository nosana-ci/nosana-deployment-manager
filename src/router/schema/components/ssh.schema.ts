import { Type } from "@sinclair/typebox";

import { MAX_SSH_PUBLIC_KEYS } from "../../../ssh/validate.js";

export const SshPublicKeysSchema = Type.Array(
  Type.String({
    minLength: 1,
    description: 'An OpenSSH public key line: "<algorithm> <base64> [comment]".',
  }),
  {
    // The count cap (with the rest of the node's rules) is enforced in one
    // place — validateSshPublicKeys — so limit violations all get its message.
    description: `The complete set of SSH public keys allowed to reach this deployment's jobs (at most ${MAX_SSH_PUBLIC_KEYS}). Replaces the current set; an empty array revokes SSH access.`,
  }
);
