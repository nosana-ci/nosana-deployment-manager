import { FastifyInstance } from "fastify";

import { routes } from "../routes/index.js";
import { routeSchemas } from "../schema/index.schema.js";

import { authJobHostMiddleware } from "../middleware/authentication/authJobHostMiddleware.js";

const {
  get: { jobDefinitionHandler, jobResultsHandler },
  post: { jobResultsPostHandler }
} = routes;
const {
  get: { JobDefinitionHandlerSchema, JobResultsHandlerSchema },
  post: { JobResultPostHandlerSchema }
} = routeSchemas;

export function setupJobsRoutes(server: FastifyInstance) {
  server.addHook("onRequest", authJobHostMiddleware);

  // GET
  server.get(
    "/api/job/:job/job-definition",
    {
      schema: JobDefinitionHandlerSchema,
    },
    jobDefinitionHandler
  );

  server.get(
    "/api/job/:job/results",
    {
      schema: JobResultsHandlerSchema
    },
    jobResultsHandler
  )

  // POST
  server.post(
    "/api/job/:job/results",
    {
      schema: JobResultPostHandlerSchema
    },
    jobResultsPostHandler
  )
}
