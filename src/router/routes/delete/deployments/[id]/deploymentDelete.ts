import type { RouteHandler } from "fastify";
import { ErrorMessages } from "../../../../../errors/index.js";
import { DeploymentStatus } from "../../../../../types/index.js";
import type { HeadersSchema } from "../../../../schema/index.schema.js";
import type { DeploymentDeleteError } from "../../../../schema/delete/index.schema.js";
import { withTransaction } from "../../../../../repositories/index.js";

export const deploymentDeleteHandler: RouteHandler<{
  Params: { deployment: string };
  Headers: HeadersSchema;
  Reply: void | DeploymentDeleteError;
}> = async (req, res) => {
  const { db } = res.locals;
  const deployment = res.locals.deployment!;
  const userId = req.headers["x-user-id"];

  if (deployment.status !== DeploymentStatus.STOPPED) {
    res
      .status(500)
      .send({ error: ErrorMessages.deployments.INCORRECT_STATE });
    return;
  }

  try {
    await withTransaction(async (session) => {
      // Get job IDs directly using distinct
      const jobIds = await db.jobs.distinct('job', { deployment: deployment.id }, { session });

      // Delete results for all jobs
      await db.results.deleteMany(
        { job: { $in: jobIds } },
        { session }
      );

      // Delete jobs
      await db.jobs.deleteMany(
        { deployment: deployment.id },
        { session }
      );

      // Delete revisions
      await db.revisions.deleteMany(
        { deployment: deployment.id },
        { session }
      );

      // Delete events
      await db.events.deleteMany(
        { deploymentId: deployment.id },
        { session }
      );

      // Delete deployment
      await db.deployments.deleteOne(
        { id: deployment.id, owner: userId },
        { session }
      );
    });

    res.status(204).send();
  } catch (error) {
    res.log.error(error);
    res
      .status(500)
      .send({ error: ErrorMessages.deployments.FAILED_TO_DELETE });
  }
};
