import { FastifyInstance } from "fastify";

import { routes } from "../routes/index.js";
import { routeSchemas } from "../schema/index.schema.js";

const {
  get: { getStatsHandler },
} = routes;
const {
  get: { StatsHandlerSchema }
} = routeSchemas;

export function setupStatsRoutes(server: FastifyInstance) {
  // GET
  server.get(
    `/stats`,
    {
      schema: StatsHandlerSchema
    },
    getStatsHandler
  );
}
