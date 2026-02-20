import type { RouteHandler } from "fastify";

import { ErrorMessages } from "../../../../errors/index.js";
import { getRepository } from "../../../../repositories/index.js";
import { NosanaCollections } from "../../../../definitions/collection.js";

import type { HeadersSchema } from "../../../schema/index.schema.js";

export const getDeploymentMiddleware: RouteHandler<{
  Params: { deployment: string };
  Headers: HeadersSchema;
}> = async (req, res) => {
  const id = req.params.deployment;
  const owner = req.headers["x-user-id"];

  const { findOne } = getRepository(NosanaCollections.DEPLOYMENTS);

  try {
    const deployment = await findOne({ id, owner, })

    if (!deployment) {
      res.status(404).send({ error: ErrorMessages.deployments.NOT_FOUND });
      return;
    }

    res.locals.deployment = deployment;
  } catch (error) {
    res.log.error(error);
    res
      .status(500)
      .send({ error: ErrorMessages.generic.SOMETHING_WENT_WRONG });
    return;
  }
};
