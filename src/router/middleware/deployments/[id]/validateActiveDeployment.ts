import type { RouteHandler } from "fastify";

import { ErrorMessages } from "../../../../errors/index.js";

import type { HeadersSchema } from "../../../schema/index.schema.js";

export const validateActiveDeploymentMiddleware: RouteHandler<{
  Params: { deployment: string };
  Headers: HeadersSchema;
}> = async (_req, res): Promise<void> => {
  const deployment = res.locals.deployment!;

  if (deployment.status === "ARCHIVED") {
    res.status(500).send({ error: ErrorMessages.deployments.ARCHIVED });
    return;
  }
};
