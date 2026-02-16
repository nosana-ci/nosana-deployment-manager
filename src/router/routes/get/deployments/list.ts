import type { RouteHandler } from "fastify";

import { fetchDeployments } from "../../../helper/fetchDeployments.js";
import { JobState } from "../../../../types/index.js";

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

    // Add active_jobs count for each deployment
    const deploymentsWithActiveJobs = await Promise.all(
      deployments.map(async (deployment) => {
        const activeJobsCount = await db.jobs.countDocuments({
          deployment: deployment.id,
          state: JobState.RUNNING
        });
        
        Reflect.deleteProperty(deployment, "_id");
        
        return {
          ...deployment,
          active_jobs: activeJobsCount,
          created_at: deployment.created_at.toISOString(),
          updated_at: deployment.updated_at.toISOString(),
        };
      })
    );

    res.status(200);

    return deploymentsWithActiveJobs;
  } catch (error) {
    res.log.error("Error fetching deployments:", error);
    res.status(500).send({ error: "Internal Server Error" });
  }
};
