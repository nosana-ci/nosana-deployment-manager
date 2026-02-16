import type { RouteHandler } from "fastify";

import type {
  GetDeploymentEventsSuccess,
  GetDeploymentEventsError,
} from "../../../../schema/get/deployments/[id]/getDeploymentEvents.schema.js";
import type { HeadersSchema } from "../../../../schema/index.schema.js";

export const getDeploymentEventsHandler: RouteHandler<{
  Params: { deployment: string };
  Headers: HeadersSchema;
  Reply: GetDeploymentEventsSuccess | GetDeploymentEventsError;
}> = async (req, res) => {
  const { db } = res.locals;
  const deployment = res.locals.deployment!;

  try {
    const events = await db.events
      .find({ deploymentId: deployment.id })
      .sort({ created_at: -1 })
      .toArray();

    res.status(200).send(
      events.map((event) => ({
        ...event,
        created_at: event.created_at.toISOString(),
      }))
    );
  } catch (error) {
    req.log.error(error);
    res.status(500).send({
      error: "Failed to get deployment events",
    });
  }
};
