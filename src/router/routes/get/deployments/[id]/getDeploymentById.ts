import type { RouteHandler } from "fastify";

import type {
  DeploymentByIdError,
  DeploymentByIdSuccess,
} from "../../../../schema/get/deployments/[id]/getDeploymentById.schema";
import type { HeadersSchema } from "../../../../schema/index.schema";

export const getDeploymentByIdHandler: RouteHandler<{
  Params: { deployment: string };
  Headers: HeadersSchema;
  Reply: DeploymentByIdSuccess | DeploymentByIdError;
}> = (_, res) => {
  const deployment = res.locals.deployment!;

  Reflect.deleteProperty(deployment, "_id");
  res.status(200);

  return {
    ...deployment,
    created_at: deployment.created_at.toISOString(),
    updated_at: deployment.updated_at.toISOString(),
    jobs: deployment.jobs.map((job) => ({
      ...job,
      created_at: job.created_at.toISOString(),
    })),
    events: deployment.events.map((event) => ({
      ...event,
      created_at: event.created_at.toISOString(),
    })),
  };
};
