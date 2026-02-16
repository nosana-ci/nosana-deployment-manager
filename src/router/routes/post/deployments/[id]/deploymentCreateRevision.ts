import type { RouteHandler } from "fastify";
import { JobDefinition } from "@nosana/kit";

import { ErrorMessages } from "../../../../../errors/index.js";

import type { HeadersSchema } from "../../../../schema/index.schema.js";
import type {
  DeploymentCreateRevisionSuccess,
  DeploymentCreateRevisionError,
} from "../../../../schema/post/index.schema.js";

import { createNewDeploymentRevision } from "../create/deploymentCreate.factory.js";

export const deploymentCreateRevisionHandler: RouteHandler<{
  Body: JobDefinition;
  Params: { deployment: string };
  Headers: HeadersSchema;
  Reply: DeploymentCreateRevisionSuccess | DeploymentCreateRevisionError;
}> = async (req, res) => {
  const { db } = res.locals;
  const jobDefinition = req.body;
  const deployment = res.locals.deployment!;
  const userId = req.headers["x-user-id"];

  try {
    const { revision, endpoints } = await createNewDeploymentRevision(deployment.active_revision, deployment.id, deployment.vault, jobDefinition);

    const { acknowledged: revAck } = await db.revisions.insertOne(revision);
    if (!revAck) {
      res.status(500).send({
        error: ErrorMessages.deployments.FAILED_TO_CREATE_NEW_REVISION,
      });
      return;
    }

    const updated_at = new Date();
    const { acknowledged } = await db.deployments.updateOne(
      {
        id: { $eq: deployment.id },
        owner: { $eq: userId },
      },
      {
        $set: {
          active_revision: revision.revision,
          endpoints,
          updated_at,
        },
      }
    );

    if (!acknowledged) {
      res.status(500).send({
        error: ErrorMessages.deployments.FAILED_TO_UPDATE_SCHEDULE,
      });
      return;
    }

    const allRevisions = await db.revisions.find({ deployment: deployment.id }).toArray();

    res.status(200).send({
      active_revision: revision.revision,
      endpoints,
      revisions: [
        ...allRevisions.map((r) => ({ ...r, created_at: r.created_at.toISOString() })),
      ],
      updated_at: updated_at.toISOString(),
    });
  } catch (error) {
    res.log.error(error);
    res
      .status(500)
      .send({ error: ErrorMessages.generic.SOMETHING_WENT_WRONG });
  }
};
