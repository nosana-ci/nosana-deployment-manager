import type { RouteHandler } from "fastify";
import { ErrorMessages } from "../../../../../errors/index.js";

import { DeploymentStatus } from "../../../../../types/index.js";

import type { HeadersSchema } from "../../../../schema/index.schema.js";
import type {
  DeploymentStopError,
  DeploymentStopSuccess,
} from "../../../../schema/post/index.schema.js";

export const deploymentStopHandler: RouteHandler<{
  Params: { deployment: string };
  Headers: HeadersSchema;
  Reply: DeploymentStopSuccess | DeploymentStopError;
}> = async (req, res) => {
  const { db } = res.locals;
  const deployment = res.locals.deployment!;
  const userId = req.headers["x-user-id"];

  if (
    deployment.status !== DeploymentStatus.RUNNING &&
    deployment.status !== DeploymentStatus.ERROR &&
    deployment.status !== DeploymentStatus.INSUFFICIENT_FUNDS
  ) {
    res.status(500).send({ error: ErrorMessages.deployments.INCORRECT_STATE });
    return;
  }

  const updated_at = new Date();
  try {
    const { acknowledged: acknowledgedDeployments } =
      await db.deployments.updateOne(
        {
          id: { $eq: deployment.id },
          owner: { $eq: userId },
        },
        {
          $set: {
            status: DeploymentStatus.STOPPING,
            updated_at,
          },
        }
      );

    if (!acknowledgedDeployments) {
      res
        .status(500)
        .send({ error: ErrorMessages.deployments.FAILED_TO_STOP });
      return;
    }

    res.status(200);
    return {
      status: DeploymentStatus.STOPPING,
      updated_at: updated_at.toISOString(),
    };
  } catch (error) {
    res.log.error(error);
    res
      .status(500)
      .send({ error: ErrorMessages.generic.SOMETHING_WENT_WRONG });
  }
};
