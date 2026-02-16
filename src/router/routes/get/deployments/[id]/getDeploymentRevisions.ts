import type { RouteHandler } from "fastify";

import type {
  GetDeploymentRevisionsSuccess,
  GetDeploymentRevisionsError,
} from "../../../../schema/get/deployments/[id]/getDeploymentRevisions.schema.js";
import type { HeadersSchema } from "../../../../schema/index.schema.js";

export const getDeploymentRevisionsHandler: RouteHandler<{
  Params: { deployment: string };
  Headers: HeadersSchema;
  Reply: GetDeploymentRevisionsSuccess | GetDeploymentRevisionsError;
}> = async (req, res) => {
  const { db } = res.locals;
  const deployment = res.locals.deployment!;

  try {
    const revisions = await db.revisions
      .find({ deployment: deployment.id })
      .sort({ revision: -1 })
      .toArray();

    res.status(200).send(
      revisions.map((revision) => ({
        ...revision,
        created_at: revision.created_at.toISOString(),
      }))
    );
  } catch (error) {
    req.log.error(error);
    res.status(500).send({
      error: "Failed to get deployment revisions",
    });
  }
};
