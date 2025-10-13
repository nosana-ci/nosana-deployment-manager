import type { RouteHandler } from "fastify";

import { ErrorMessages } from "../../../../errors/index.js";
import { fetchDeployments } from "../../../helper/fetchDeployments.js";

import type { HeadersSchema } from "../../../schema/index.schema.js";

export const getDeploymentMiddleware: RouteHandler<{
  Params: { deployment: string };
  Headers: HeadersSchema;
}> = async (req, res) => {
  const { db } = res.locals;
  const id = req.params.deployment;
  const owner = req.headers["x-user-id"];

  try {
    const deployments = await fetchDeployments({ id, owner }, db.deployments);

    if (deployments.length === 0) {
      res.status(404).send({ error: ErrorMessages.deployments.NOT_FOUND });
      return;
    }

    res.locals.deployment = deployments[0];
  } catch (error) {
    res.log.error(error);
    res
      .status(500)
      .send({ error: ErrorMessages.generic.SOMETHING_WENT_WRONG });
    return;
  }
};
