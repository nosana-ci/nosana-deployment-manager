import type { RouteHandler } from "fastify";

import { ErrorMessages } from "../../../../../errors/index.js";
import { getKit } from "../../../../../kit/index.js";
import { injectSsh } from "../../../../../ssh/index.js";

import type { HeadersSchema } from "../../../../schema/index.schema.js";
import type {
  DeploymentUpdateActiveRevisionSuccess,
  DeploymentUpdateActiveRevisionError,
} from "../../../../schema/patch/index.schema.js";
import { createDeploymentRevisionEndpoints } from "../../../post/deployments/create/deploymentCreate.factory.js";

export const deploymentUpdateActiveRevisionHandler: RouteHandler<{
  Body: { active_revision: number };
  Params: { deployment: string };
  Headers: HeadersSchema;
  Reply: DeploymentUpdateActiveRevisionSuccess | DeploymentUpdateActiveRevisionError;
}> = async (req, res) => {
  const { db } = res.locals;
  const active_revision = req.body.active_revision;
  const deployment = res.locals.deployment!;
  const userId = req.headers["x-user-id"];

  const revision = await db.revisions.findOne({ deployment: deployment.id, revision: active_revision });

  if (!revision) {
    res.status(400).send({
      error: ErrorMessages.deployments.INVALID_ACTIVE_REVISION,
    });
    return;
  }

  if (revision.revision === deployment.active_revision) {
    res.status(400).send({
      error: ErrorMessages.deployments.REVISION_ALREADY_ACTIVE,
    });
    return;
  }

  try {
    const updated_at = new Date();
    const endpoints = createDeploymentRevisionEndpoints(deployment.id, deployment.vault, revision.job_definition);

    // Re-pinned BEFORE the swap, so a LIST of the newly active revision never
    // reads a stale pin. The swap below is fenced on the revision not being
    // active yet; if a concurrent request activated it first, this pin is the
    // active revision's current one all the same.
    if (!deployment.confidential) {
      const ipfs_definition_hash = await getKit().ipfs.pin(
        injectSsh(revision.job_definition, deployment.ssh_public_keys)
      );
      await db.revisions.updateOne(
        { deployment: deployment.id, revision: active_revision },
        { $set: { ipfs_definition_hash } }
      );
    }

    const { matchedCount } = await db.deployments.updateOne(
      {
        id: { $eq: deployment.id },
        owner: { $eq: userId },
        active_revision: { $ne: active_revision },
      },
      {
        $set: {
          active_revision,
          endpoints,
          updated_at,
        },
      }
    );

    if (matchedCount === 0) {
      res.status(400).send({
        error: ErrorMessages.deployments.REVISION_ALREADY_ACTIVE,
      });
      return;
    }

    res.status(200).send({
      active_revision,
      endpoints,
      updated_at: updated_at.toISOString(),
    });
  } catch (error) {
    res.log.error(error);
    res
      .status(500)
      .send({ error: ErrorMessages.generic.SOMETHING_WENT_WRONG });
  }
};
