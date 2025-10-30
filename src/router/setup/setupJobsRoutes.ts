import { FastifyInstance } from "fastify";

import { routes } from "../routes/index.js";
import { routeSchemas } from "../schema/index.schema.js";

import { authJobHostMiddleware } from "../middleware/authentication/authJobHostMiddleware.js";
import { API_PREFIX } from "../../definitions/api.js";

const {
  get: { jobDefinitionHandler },
  post: { jobResultsPostHandler }
} = routes;
const {
  get: { JobDefinitionHandlerSchema },
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

  // POST
  server.post(
    `${JOBS_API_PREFIX}/:job/results`,
    {
      schema: JobResultPostHandlerSchema
    },
    jobResultsPostHandler
  )
}
