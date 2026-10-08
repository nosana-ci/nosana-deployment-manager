import type { RouteHandler } from "fastify";

import { ErrorMessages } from "../../../../../errors/index.js";

import type { DeploymentRequirements } from "../../../../schema/components/requirements.schema.js";
import type { HeadersSchema } from "../../../../schema/index.schema.js";
import type {
  DeploymentUpdateRequirementsError,
  DeploymentUpdateRequirementsSuccess,
} from "../../../../schema/patch/index.schema.js";

/**
 * Writes the requirements and the market that serves them in one write; the
 * market follows the GPU, as on create. LIST reads both when it reserves, so
 * every job listed from now on lands on a node that meets them. Running jobs
 * keep their hosts unless the market changed: then `deploymentMarketUpdate`,
 * on the worker, moves them.
 */
export const deploymentUpdateRequirementsHandler: RouteHandler<{
  Body: { requirements: DeploymentRequirements | null; market: string };
  Params: { deployment: string };
  Headers: HeadersSchema;
  Reply: DeploymentUpdateRequirementsSuccess | DeploymentUpdateRequirementsError;
}> = async (req, res) => {
  const { db } = res.locals;
  const requirements = req.body.requirements;
  const deployment = res.locals.deployment!;
  const market = req.body.market.trim();
  const userId = req.headers["x-user-id"];

  try {
    const updated_at = new Date();
    const { acknowledged } = await db.deployments.updateOne(
      {
        id: { $eq: deployment.id },
        owner: { $eq: userId },
      },
      {
        $set: {
          requirements,
          market,
          updated_at,
        },
      }
    );

    if (!acknowledged) {
      res.status(500).send({
        error: ErrorMessages.deployments.FAILED_REQUIREMENTS_UPDATE,
      });
      return;
    }

    res.status(200).send({
      requirements,
      market,
      updated_at: updated_at.toISOString(),
    });
  } catch (error) {
    res.log.error(error);
    res
      .status(500)
      .send({ error: ErrorMessages.generic.SOMETHING_WENT_WRONG });
  }
};
