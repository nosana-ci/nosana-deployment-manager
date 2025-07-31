import type { RouteHandler } from "fastify";

import { ErrorsMessages } from "../../../../errors/index.js";
import { HeadersSchema } from "../../../schema/index.schema.js";

export const validateActiveDeploymentMiddleware: RouteHandler<{
  Params: { deployment: string };
  Headers: HeadersSchema;
}> = async (_req, res): Promise<void> => {
  const deployment = res.locals.deployment!;

  if (deployment.status === "ARCHIVED") {
    res.status(500).send({ error: ErrorsMessages.deployments.ARCHIVED });
    return;
  }
};
