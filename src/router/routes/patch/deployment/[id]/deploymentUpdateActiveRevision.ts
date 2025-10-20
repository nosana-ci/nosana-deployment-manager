import type { RouteHandler } from "fastify";

import { ErrorMessages } from "../../../../../errors/index.js";

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

  const revision = deployment.revisions.find((r) => r.revision === active_revision);

  if (!revision) {
    res.status(400).send({
      error: ErrorMessages.deployments.INVALID_ACTIVE_REVISION,
    });
    return;
  }

  try {
    const updated_at = new Date();
    const endpoints = createDeploymentRevisionEndpoints(deployment.id, deployment.vault, revision.job_definition);
    const { acknowledged } = await db.deployments.updateOne(
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

    if (!acknowledged) {
      res.status(500).send({
        error: ErrorMessages.deployments.FAILED_TO_UPDATE_ACTIVE_REVISION,
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
