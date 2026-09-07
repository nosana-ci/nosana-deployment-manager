import { Static, Type } from "@sinclair/typebox";

import { MAX_SSH_PUBLIC_KEYS } from "@nosana/kit";

export const SshPublicKeysSchema = Type.Array(
  Type.String({
    minLength: 1,
    description: 'An OpenSSH public key line: "<algorithm> <base64> [comment]".',
  }),
  {
    // The count cap (with the rest of the node's rules) is enforced in one
    // place — validateSshPublicKeys — so limit violations all get its message.
    description: `SSH public keys, each an OpenSSH line. At most ${MAX_SSH_PUBLIC_KEYS} keys total on a deployment; a key already present (same type and material) is left as it is.`,
  }
);

/** The body of both the add and revoke routes: the keys to grant or revoke. */
export const SshKeysBody = Type.Object({
  public_keys: SshPublicKeysSchema,
});

export type SshKeysBody = Static<typeof SshKeysBody>;

/** Per running job: whether its node applied the change. */
export const JobSshKeysResultSchema = Type.Object({
  job: Type.String(),
  node: Type.String(),
  status: Type.Union([Type.Literal("authorized"), Type.Literal("revoked"), Type.Literal("failed")]),
  error: Type.Optional(Type.String()),
});

export type JobSshKeysResult = Static<typeof JobSshKeysResultSchema>;

/** The reply shared by the add and revoke routes: the resulting set and per-job outcomes. */
export const SshKeysResultSchema = Type.Object({
  public_keys: Type.Array(Type.String()),
  updated_at: Type.String({ format: "date-time" }),
  jobs: Type.Array(JobSshKeysResultSchema, {
    description:
      "Per running job whose node was contacted to apply the change. Empty when nothing changed or nothing is running.",
  }),
});

export type SshKeysResult = Static<typeof SshKeysResultSchema>;
