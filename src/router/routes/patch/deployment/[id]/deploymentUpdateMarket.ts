import type { RouteHandler } from "fastify";

import { ErrorMessages } from "../../../../../errors/index.js";

import type { HeadersSchema } from "../../../../schema/index.schema.js";
import type {
  DeploymentUpdateMarketError,
  DeploymentUpdateMarketSuccess,
} from "../../../../schema/patch/index.schema.js";

/**
 * Only writes the new market. Moving a RUNNING deployment's jobs onto it is the
 * worker's job — see `deploymentMarketUpdate`, which reacts to this write.
 */
export const deploymentUpdateMarketHandler: RouteHandler<{
  Body: { market: string };
  Params: { deployment: string };
  Headers: HeadersSchema;
  Reply: DeploymentUpdateMarketSuccess | DeploymentUpdateMarketError;
}> = async (req, res) => {
  const { db } = res.locals;
  const market = req.body.market.trim();
  const deployment = res.locals.deployment!;
  const userId = req.headers["x-user-id"];

  try {
    const updated_at = new Date();
    const { acknowledged } = await db.deployments.updateOne(
      {
        id: { $eq: deployment.id },
        owner: { $eq: userId },
        market: { $ne: market },
      },
      {
        $set: {
          market,
          updated_at,
        },
      }
    );

    if (!acknowledged) {
      res.status(500).send({
        error: ErrorMessages.deployments.FAILED_MARKET_UPDATE,
      });
      return;
    }

    res.status(200).send({
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
