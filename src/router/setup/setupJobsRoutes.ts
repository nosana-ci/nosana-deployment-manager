import { FastifyInstance } from "fastify";

import { routes } from "../routes/index.js";
import { routeSchemas } from "../schema/index.schema.js";

import { authJobHostMiddleware } from "../middleware/authentication/authJobHostMiddleware.js";
import { API_PREFIX } from "../../definitions/api.js";

const {
  get: { jobDefinitionHandler, jobResultsHandler },
  post: { jobResultsPostHandler }
} = routes;
const {
  get: { JobDefinitionHandlerSchema, JobResultsHandlerSchema },
  post: { JobResultPostHandlerSchema }
} = routeSchemas;

const JOBS_API_PREFIX = `${API_PREFIX}/jobs`;

export function setupJobsRoutes(server: FastifyInstance) {
  server.addHook("onRequest", authJobHostMiddleware);

  // GET
  server.get(
    `${JOBS_API_PREFIX}/:job/job-definition`,
    {
      schema: JobDefinitionHandlerSchema,
    },
    jobDefinitionHandler
  );

  server.get(
    `${JOBS_API_PREFIX}/:job/results`,
    {
      schema: JobResultsHandlerSchema
    },
    jobResultsHandler
  )

  // POST
  server.post(
    `${JOBS_API_PREFIX}/:job/results`,
    {
      schema: JobResultPostHandlerSchema
    },
    jobResultsPostHandler
  )
}
