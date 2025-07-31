import type { RouteHandler } from "fastify";

import { ErrorsMessages } from "../../../../../errors/index.js";

import type { HeadersSchema } from "../../../../schema/index.schema.js";
import type {
  DeploymentUpdateTimeoutError,
  DeploymentUpdateTimeoutSuccess,
} from "../../../../schema/patch/index.schema.js";

export const deploymentUpdateTimeoutHandler: RouteHandler<{
  Body: { timeout: number };
  Params: { deployment: string };
  Headers: HeadersSchema;
  Reply: DeploymentUpdateTimeoutSuccess | DeploymentUpdateTimeoutError;
}> = async (req, res) => {
  const { db } = res.locals;
  const timeout = req.body.timeout;
  const deployment = res.locals.deployment!;
  const userId = req.headers["x-user-id"];

  try {
    const updated_at = new Date();
    const { acknowledged } = await db.deployments.updateOne(
      {
        id: { $eq: deployment.id },
        owner: { $eq: userId },
        timeout: { $ne: timeout },
      },
      {
        $set: {
          timeout,
          updated_at,
        },
      }
    );

    if (!acknowledged) {
      res.status(500).send({
        error: ErrorsMessages.deployments.FAILED_TIMEOUT_UPDATE,
      });
      return;
    }

    res.status(200).send({
      timeout,
      updated_at: updated_at.toISOString(),
    });
  } catch (error) {
    res.log.error(error);
    res
      .status(500)
      .send({ error: ErrorsMessages.generic.SOMETHING_WENT_WRONG });
  }
};
