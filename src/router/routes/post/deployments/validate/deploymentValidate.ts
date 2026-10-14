import { RouteHandler } from "fastify";

import { jobDefinitionErrors } from "../../../../validators/jobDefinitionValidation.js";

import type { HeadersSchema } from "../../../../schema/index.schema.js";
import type { DeploymentValidateResponse } from "../../../../schema/post/index.schema.js";

export const deploymentValidateHandler: RouteHandler<{
  Headers: HeadersSchema;
  Reply: DeploymentValidateResponse;
}> = async (req, res) => {
  const body = req.body as { job_definition?: unknown } | null;
  const errors =
    body && typeof body === "object" && body.job_definition !== undefined
      ? jobDefinitionErrors(body.job_definition)
      : ["job_definition: Expected required property"];
  res.status(200).send({ valid: errors.length === 0, errors });
};
