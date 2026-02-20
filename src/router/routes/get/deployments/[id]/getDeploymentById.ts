import type { RouteHandler } from "fastify";

import { getRepository } from "../../../../../repositories/index.js";
import { NosanaCollections } from "../../../../../definitions/collection.js";

import { JobState } from "../../../../../types/index.js";
import type { HeadersSchema } from "../../../../schema/index.schema.js";
import type {
  DeploymentByIdError,
  DeploymentByIdSuccess,
} from "../../../../schema/get/deployments/[id]/getDeploymentById.schema.js";

export const getDeploymentByIdHandler: RouteHandler<{
  Params: { deployment: string };
  Headers: HeadersSchema;
  Reply: DeploymentByIdSuccess | DeploymentByIdError;
}> = async (_, res) => {
  const deployment = res.locals.deployment!;

  const { count } = getRepository(NosanaCollections.JOBS);

  const active_jobs = await count({
    deployment: deployment.id,
    state: JobState.RUNNING
  });

  res.status(200);

  return {
    ...deployment,
    active_jobs,
    created_at: deployment.created_at.toISOString(),
    updated_at: deployment.updated_at.toISOString(),
  };
};
