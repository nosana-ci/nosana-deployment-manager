import type { RouteHandler } from "fastify";

import { ErrorMessages } from "../../../../errors/index.js";
import { fetchDeployments } from "../../../helper/fetchDeployments.js";
import { JobState } from "../../../../types/index.js";

import type { HeadersSchema } from "../../../schema/index.schema.js";

export const getDeploymentMiddleware: RouteHandler<{
  Params: { deployment: string };
  Headers: HeadersSchema;
}> = async (req, res) => {
  const { db } = res.locals;
  const id = req.params.deployment;
  const owner = req.headers["x-user-id"];

  try {
    const deployments = await fetchDeployments({ id, owner }, db.deployments);

    if (deployments.length === 0) {
      res.status(404).send({ error: ErrorMessages.deployments.NOT_FOUND });
      return;
    }

    const deployment = deployments[0];
    
    // Add active_jobs count
    const activeJobsCount = await db.jobs.countDocuments({
      deployment: deployment.id,
      state: JobState.RUNNING
    });

    res.locals.deployment = {
      ...deployment,
      active_jobs: activeJobsCount
    };
  } catch (error) {
    res.log.error(error);
    res
      .status(500)
      .send({ error: ErrorMessages.generic.SOMETHING_WENT_WRONG });
    return;
  }
};
