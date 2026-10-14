import { RouteHandler } from "fastify";

import { deploymentCreateErrors } from "../../../../validators/deploymentCreateValidation.js";

import type { HeadersSchema } from "../../../../schema/index.schema.js";
import type { DeploymentValidateResponse } from "../../../../schema/post/index.schema.js";

export const deploymentValidateHandler: RouteHandler<{
  Headers: HeadersSchema;
  Reply: DeploymentValidateResponse;
}> = async (req, res) => {
  const errors = deploymentCreateErrors(req.body);
  res.status(200).send({ valid: errors.length === 0, errors });
};
