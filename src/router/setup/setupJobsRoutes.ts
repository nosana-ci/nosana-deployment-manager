import { FastifyInstance } from "fastify";

import { routes } from "../routes/index.js";
import { routeSchemas } from "../schema/index.schema.js";
import { authJobsMiddleware } from "../middleware/authentication/authJobsMiddleware.js";

const {
  get: { jobDefinitionHandler, jobResultsHandler },
  post: { jobResultsPostHandler }
} = routes;
const {
  get: { JobDefinitionHandlerSchema, JobResultsHandlerSchema },
  post: { JobResultPostHandlerSchema }
} = routeSchemas;

export function setupJobsRoutes(server: FastifyInstance) {
  server.addHook("onRequest", authJobsMiddleware);

  // GET
  server.get(
    "/api/jobs/:job/job-definition",
    {
      schema: JobDefinitionHandlerSchema,
    },
    jobDefinitionHandler
  );

  server.get(
    "api/jobs/:job/results",
    {
      schema: JobResultsHandlerSchema
    },
    jobResultsHandler
  )

  // POST
  server.post(
    "/api/jobs/:job/results",
    {
      schema: JobResultPostHandlerSchema
    },
    jobResultsPostHandler
  )
}
