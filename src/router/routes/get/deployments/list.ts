import type { RouteHandler } from "fastify";

import { fetchDeployments } from "../../../helper/fetchDeployments.js";

import type {
  DeploymentsHandlerSuccess,
  DeploymentsHandlerError,
} from "../../../schema/get/deployments/list.schema.js";
import type { HeadersSchema } from "../../../schema/index.schema.js";

export const deploymentsHandler: RouteHandler<{
  Headers: HeadersSchema;
  Reply: DeploymentsHandlerSuccess | DeploymentsHandlerError;
}> = async (req, res) => {
  const { db } = res.locals;
  const userId = req.headers["x-user-id"];

  try {
    const deployments = await fetchDeployments(
      { owner: userId as string },
      db.deployments
    );

    deployments.forEach((deployment) => {
      Reflect.deleteProperty(deployment, "_id");
    });

    res.status(200);

    return deployments.map((deployment) => ({
      ...deployment,
      created_at: deployment.created_at.toISOString(),
      updated_at: deployment.updated_at.toISOString(),
      jobs: deployment.jobs.map((job) => ({
        ...job,
        created_at: job.created_at.toISOString(),
        updated_at: job.updated_at.toISOString(),
      })),
      events: deployment.events.map((event) => ({
        ...event,
        created_at: event.created_at.toISOString(),
      })),
      revisions: deployment.revisions.map((revision) => ({
        ...revision,
        created_at: revision.created_at.toISOString(),
      })),
    }));
  } catch (error) {
    res.log.error("Error fetching deployments:", error);
    res.status(500).send({ error: "Internal Server Error" });
  }
};
