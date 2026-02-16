import type { RouteHandler } from "fastify";

import type {
  GetDeploymentJobsSuccess,
  GetDeploymentJobsError,
} from "../../../../schema/get/deployments/[id]/getDeploymentJobs.schema.js";
import type { HeadersSchema } from "../../../../schema/index.schema.js";

export const getDeploymentJobsHandler: RouteHandler<{
  Params: { deployment: string };
  Headers: HeadersSchema;
  Reply: GetDeploymentJobsSuccess | GetDeploymentJobsError;
}> = async (req, res) => {
  const { db } = res.locals;
  const deployment = res.locals.deployment!;

  try {
    const jobs = await db.jobs
      .find({ deployment: deployment.id })
      .sort({ created_at: -1 })
      .toArray();

    res.status(200).send(
      jobs.map((job) => ({
        ...job,
        created_at: job.created_at.toISOString(),
        updated_at: job.updated_at.toISOString(),
      }))
    );
  } catch (error) {
    req.log.error(error);
    res.status(500).send({
      error: "Failed to get deployment jobs",
    });
  }
};
