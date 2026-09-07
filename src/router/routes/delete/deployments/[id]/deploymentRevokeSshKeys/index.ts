import type { RouteHandler } from "fastify";

import { getSshKeyIdentity } from "@nosana/kit";

import { ErrorMessages } from "../../../../../../errors/index.js";
import { commitDeploymentSshKeys } from "../../../../../../ssh/index.js";

import type { HeadersSchema } from "../../../../../schema/index.schema.js";
import type { ErrorSchema, SshKeysBody, SshKeysResult } from "../../../../../schema/index.schema.js";

/**
 * Revoke one or more SSH public keys from a deployment. A key is matched by
 * type and material, so a differing comment still revokes it. The key leaves
 * the deployment's set (future jobs won't get it) and is revoked on the node of
 * every job currently running, so access stops at once rather than on restart.
 */
export const deploymentRevokeSshKeysHandler: RouteHandler<{
  Body: SshKeysBody;
  Params: { deployment: string };
  Headers: HeadersSchema;
  Reply: SshKeysResult | ErrorSchema;
}> = async (req, res) => {
  const deployment = res.locals.deployment!;
  const current = deployment.ssh_public_keys ?? [];
  const removed = new Set(req.body.public_keys.map(getSshKeyIdentity));

  const next = current.filter((key) => !removed.has(getSshKeyIdentity(key)));
  const delta = current.filter((key) => removed.has(getSshKeyIdentity(key)));

  // None of the requested keys are present: nothing to store, pin, push or log.
  if (delta.length === 0) {
    res.status(200).send({ public_keys: current, updated_at: deployment.updated_at.toISOString(), jobs: [] });
    return;
  }

  try {
    await commitDeploymentSshKeys(req, res, {
      next,
      delta,
      operation: "revoke",
      event: ({ next, applied, total }) =>
        `SSH keys revoked (${delta.length} removed, ${next.length} remaining); revoked on ${applied}/${total} running job(s).`,
    });
  } catch (error) {
    res.log.error("Error revoking deployment SSH keys: %s", String(error));
    res.status(500).send({ error: ErrorMessages.generic.SOMETHING_WENT_WRONG });
  }
};
