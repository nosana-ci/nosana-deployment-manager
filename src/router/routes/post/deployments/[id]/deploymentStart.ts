import type { RouteHandler } from "fastify";

import { ErrorsMessages } from "../../../../../errors/index.js";
import { DeploymentStatus } from "../../../../../types/index.js";

import type {
  DeploymentStartSuccess,
  DeploymentStartError,
} from "../../../../schema/post/deployments/[id]/deploymentStart.schema.js";
import type { HeadersSchema } from "../../../../schema/index.schema.js";

export const deploymentStartHandler: RouteHandler<{
  Params: { deployment: string };
  Headers: HeadersSchema;
  Reply: DeploymentStartSuccess | DeploymentStartError;
}> = async (req, res) => {
  const { db } = res.locals;
  const deployment = res.locals.deployment!;
  const userId = req.headers["x-user-id"];

  if (
    deployment.status !== DeploymentStatus.DRAFT &&
    deployment.status !== DeploymentStatus.STOPPED &&
    deployment.status !== DeploymentStatus.ERROR &&
    deployment.status !== DeploymentStatus.INSUFFICIENT_FUNDS
  ) {
    res.status(500).send({ error: ErrorsMessages.deployments.INCORRECT_STATE });
    return;
  }

  try {
    const updated_at = new Date();
    const { acknowledged } = await db.deployments.updateOne(
      { id: { $eq: deployment.id }, owner: { $eq: userId } },
      {
        $set: {
          status: DeploymentStatus.STARTING,
          updated_at,
        },
      }
    );

    if (!acknowledged) {
      res
        .status(500)
        .send({ error: ErrorsMessages.deployments.FAILED_STARTING });
      return;
    }

    res
      .status(200)
      .send({
        status: DeploymentStatus.STARTING,
        updated_at: updated_at.toISOString(),
      });
  } catch (error) {
    res.log.error(error);
    res
      .status(500)
      .send({ error: ErrorsMessages.generic.SOMETHING_WENT_WRONG });
  }
};
