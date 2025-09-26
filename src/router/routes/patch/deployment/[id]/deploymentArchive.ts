import type { RouteHandler } from "fastify";

import { ErrorsMessages } from "../../../../../errors/index.js";
import { DeploymentStatus } from "../../../../../types/index.js";

import type { HeadersSchema } from "../../../../schema/index.schema.js";

import type {
  DeploymentArchiveError,
  DeploymentArchiveSuccess,
} from "../../../../schema/patch/deployments/[id]/deploymentArchive.schema.js";

export const deploymentArchiveHandler: RouteHandler<{
  Params: { deployment: string };
  Headers: HeadersSchema;
  Reply: DeploymentArchiveSuccess | DeploymentArchiveError;
}> = async (req, res) => {
  const { db } = res.locals;
  const deployment = res.locals.deployment!;
  const userId = req.headers["x-user-id"];

  try {
    const updated_at = new Date();
    if (deployment.status !== "STOPPED") {
      res
        .status(500)
        .send({ error: ErrorsMessages.deployments.INCORRECT_STATE });
      return;
    }

    const { acknowledged: acknowledgedDeployments } =
      await db.deployments.updateOne(
        {
          id: { $eq: deployment.id },
          owner: { $eq: userId },
        },
        {
          $set: {
            status: DeploymentStatus.ARCHIVED,
            updated_at,
          },
        }
      );

    if (!acknowledgedDeployments) {
      res
        .status(500)
        .send({ error: ErrorsMessages.deployments.FAILED_TO_ARCHIVE });
      return;
    }

    res.status(200).send({
      status: DeploymentStatus.ARCHIVED,
      updated_at: updated_at.toISOString(),
    });
  } catch (error) {
    res.log.error(error);
    res
      .status(500)
      .send({ error: ErrorsMessages.generic.SOMETHING_WENT_WRONG });
  }
};
