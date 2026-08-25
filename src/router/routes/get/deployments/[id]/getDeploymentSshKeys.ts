import type { RouteHandler } from "fastify";

import type { HeadersSchema } from "../../../../schema/index.schema.js";
import type {
  GetDeploymentSshKeysSuccess,
  GetDeploymentSshKeysError,
} from "../../../../schema/get/deployments/[id]/getDeploymentSshKeys.schema.js";

export const getDeploymentSshKeysHandler: RouteHandler<{
  Params: { deployment: string };
  Headers: HeadersSchema;
  Reply: GetDeploymentSshKeysSuccess | GetDeploymentSshKeysError;
}> = async (_req, res) => {
  const deployment = res.locals.deployment!;

  res.status(200).send({ public_keys: deployment.ssh_public_keys ?? [] });
};
