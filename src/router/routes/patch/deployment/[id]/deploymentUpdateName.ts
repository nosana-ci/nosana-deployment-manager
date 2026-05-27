import type { RouteHandler } from "fastify";

import { ErrorMessages } from "../../../../../errors/index.js";

import type { HeadersSchema } from "../../../../schema/index.schema.js";
import type {
  DeploymentUpdateNameError,
  DeploymentUpdateNameSuccess,
} from "../../../../schema/patch/index.schema.js";

export const deploymentUpdateNameHandler: RouteHandler<{
  Body: { name: string };
  Params: { deployment: string };
  Headers: HeadersSchema;
  Reply: DeploymentUpdateNameSuccess | DeploymentUpdateNameError;
}> = async (req, res) => {
  const { db } = res.locals;
  const name = req.body.name;
  const deployment = res.locals.deployment!;
  const userId = req.headers["x-user-id"];

  try {
    const updated_at = new Date();
    const { acknowledged } = await db.deployments.updateOne(
      {
        id: { $eq: deployment.id },
        owner: { $eq: userId },
        name: { $ne: name },
      },
      {
        $set: {
          name,
          updated_at,
        },
      }
    );

    if (!acknowledged) {
      res.status(500).send({
        error: ErrorMessages.deployments.FAILED_NAME_UPDATE,
      });
      return;
    }

    res.status(200).send({
      name,
      updated_at: updated_at.toISOString(),
    });
  } catch (error) {
    res.log.error(error);
    res
      .status(500)
      .send({ error: ErrorMessages.generic.SOMETHING_WENT_WRONG });
  }
};
