import type { RouteHandler } from "fastify";

import { getSshKeyIdentity } from "@nosana/kit";

import { ErrorMessages } from "../../../../../../errors/index.js";
import { validateSshPublicKeys } from "../../../../../../ssh/index.js";
import { commitDeploymentSshKeys } from "../../../../../../ssh/index.js";

import type { HeadersSchema } from "../../../../../schema/index.schema.js";
import type { ErrorSchema, SshKeysBody, SshKeysResult } from "../../../../../schema/index.schema.js";

/**
 * Grant one or more SSH public keys to a deployment. Keys already present (by
 * type and material) are ignored; the rest are merged into the deployment's set
 * — stored on the deployment, not a revision, so nothing redeploys — and
 * authorized on the node of every job currently running.
 */
export const deploymentAddSshKeysHandler: RouteHandler<{
  Body: SshKeysBody;
  Params: { deployment: string };
  Headers: HeadersSchema;
  Reply: SshKeysResult | ErrorSchema;
}> = async (req, res) => {
  const deployment = res.locals.deployment!;
  const current = deployment.ssh_public_keys ?? [];
  const additions = req.body.public_keys.map((key) => key.trim());

  const invalid = validateSshPublicKeys(additions);
  if (invalid) {
    res.status(400).send({ error: invalid });
    return;
  }

  const present = new Set(current.map(getSshKeyIdentity));
  const delta: string[] = [];
  for (const key of additions) {
    const identity = getSshKeyIdentity(key);
    if (present.has(identity)) continue;
    present.add(identity);
    delta.push(key);
  }
  // Every requested key is already present: nothing to store, pin, push or log.
  if (delta.length === 0) {
    res.status(200).send({ public_keys: current, updated_at: deployment.updated_at.toISOString(), jobs: [] });
    return;
  }

  const next = [...current, ...delta];

  const invalidSet = validateSshPublicKeys(next);
  if (invalidSet) {
    res.status(400).send({ error: invalidSet });
    return;
  }

  try {
    await commitDeploymentSshKeys(req, res, {
      next,
      delta,
      operation: "authorize",
      event: ({ next, applied, total }) =>
        `SSH keys added (${delta.length} new, ${next.length} total); authorized on ${applied}/${total} running job(s).`,
    });
  } catch (error) {
    res.log.error("Error adding deployment SSH keys: %s", String(error));
    res.status(500).send({ error: ErrorMessages.generic.SOMETHING_WENT_WRONG });
  }
};
