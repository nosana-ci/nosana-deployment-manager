import type { RouteHandler } from "fastify";

import { ErrorMessages } from "../../../../../errors/index.js";
import { DeploymentStatus } from "../../../../../types/index.js";

import type { HeadersSchema } from "../../../../schema/index.schema.js";
import type {
  DeploymentDuplicateBody,
  DeploymentDuplicateError,
  DeploymentDuplicateSuccess,
} from "../../../../schema/post/index.schema.js";

import { duplicateDeployment } from "../create/deploymentCreate.factory.js";

export const deploymentDuplicateHandler: RouteHandler<{
  Body: DeploymentDuplicateBody;
  Params: { deployment: string };
  Headers: HeadersSchema;
  Reply: DeploymentDuplicateSuccess | DeploymentDuplicateError;
}> = async (req, res) => {
  const { db } = res.locals;
  const source = res.locals.deployment!;
  const userId = req.headers["x-user-id"];

  try {
    const active = await db.revisions.findOne({
      deployment: source.id,
      revision: source.active_revision,
    });

    if (!active) {
      res.status(500).send({ error: ErrorMessages.deployments.FAILED_TO_DUPLICATE });
      return;
    }

    const created_at = new Date();
    const { deployment, revision } = await duplicateDeployment(
      source,
      active.job_definition,
      req.body.name ?? `${source.name} (copy)`,
      userId,
      created_at
    );

    const { acknowledged: revisionAcknowledged } = await db.revisions.insertOne(revision);

    if (!revisionAcknowledged) {
      res.status(500).send({ error: ErrorMessages.deployments.FAILED_TO_CREATE_NEW_REVISION });
      return;
    }

    const { acknowledged } = await db.deployments.insertOne(deployment);

    if (!acknowledged) {
      res.status(500).send({ error: ErrorMessages.deployments.FAILED_TO_DUPLICATE });
      return;
    }

    // Auto-start: move DRAFT -> STARTING via an update so the change-stream
    // listener schedules the first LIST task (listeners only react to updates).
    const status = req.body.autostart ? DeploymentStatus.STARTING : DeploymentStatus.DRAFT;
    if (req.body.autostart) {
      await db.deployments.updateOne(
        { id: deployment.id, owner: userId },
        { $set: { status, updated_at: created_at } }
      );
    }

    res.status(200);
    return {
      ...deployment,
      status,
      active_jobs: 0,
      created_at: created_at.toISOString(),
      updated_at: created_at.toISOString(),
    };
  } catch (error) {
    res.log.error(error);
    res
      .status(500)
      .send({ error: ErrorMessages.generic.SOMETHING_WENT_WRONG });
  }
};
