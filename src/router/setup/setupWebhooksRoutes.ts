import { FastifyInstance } from "fastify";

import { authHostManagerWebhookMiddleware } from "../middleware/index.js";
import { routes } from "../routes/index.js";
import { routeSchemas } from "../schema/index.schema.js";

const {
  post: { reservationWebhookHandler },
} = routes;
const {
  post: { ReservationWebhookSchema },
} = routeSchemas;

/**
 * Webhooks from our own services on internal (in-cluster) routes: outside user
 * auth, authenticated by the shared host-manager API key.
 */
export function setupWebhooksRoutes(server: FastifyInstance) {
  // POST
  server.post(
    "/webhooks/reservations",
    {
      schema: ReservationWebhookSchema,
      onRequest: [authHostManagerWebhookMiddleware],
    },
    reservationWebhookHandler
  );
}
