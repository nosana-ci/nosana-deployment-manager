import { FastifyInstance } from "fastify";

import { routes } from "../routes/index.js";
import { routeSchemas } from "../schema/index.schema.js";
import { authJobsMiddleware } from "../middleware/authentication/authJobsMiddleware.js";

const {
  get: { jobDefinitionHandler },
} = routes;
const {
  get: { JobDefinitionHandlerSchema },
} = routeSchemas;

export function setupJobsRoutes(server: FastifyInstance) {
  server.addHook("onRequest", authJobsMiddleware);

  server.get(
    "/api/jobs/:job/job-definition",
    {
      schema: JobDefinitionHandlerSchema,
    },
    jobDefinitionHandler
  );
}
