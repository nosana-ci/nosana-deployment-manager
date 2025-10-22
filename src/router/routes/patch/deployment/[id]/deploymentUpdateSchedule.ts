import type { RouteHandler } from "fastify";

import { ErrorMessages } from "../../../../../errors/index.js";

import type { HeadersSchema } from "../../../../schema/index.schema.js";
import type {
  DeploymentUpdateScheduleSuccess,
  DeploymentUpdateScheduleError,
} from "../../../../schema/patch/index.schema.js";

import { DeploymentStrategy } from "../../../../../types/index.js";

export const deploymentUpdateScheduleHandler: RouteHandler<{
  Body: { schedule: string };
  Params: { deployment: string };
  Headers: HeadersSchema;
  Reply: DeploymentUpdateScheduleSuccess | DeploymentUpdateScheduleError;
}> = async (req, res) => {
  const { db } = res.locals;
  const schedule = req.body.schedule;
  const deployment = res.locals.deployment!;
  const userId = req.headers["x-user-id"];

  if (deployment.strategy !== DeploymentStrategy.SCHEDULED) {
    res.status(400).send({
      error: ErrorMessages.deployments.INCORRECT_STRATEGY,
    });
    return;
  }

  try {
    const updated_at = new Date();
    const { acknowledged } = await db.deployments.updateOne(
      {
        id: { $eq: deployment.id },
        owner: { $eq: userId },
        schedule: { $ne: schedule },
      },
      {
        $set: {
          schedule,
          updated_at,
        },
      }
    );

    if (!acknowledged) {
      res.status(500).send({
        error: ErrorMessages.deployments.FAILED_TO_UPDATE_SCHEDULE,
      });
      return;
    }

    res.status(200).send({
      schedule,
      updated_at: updated_at.toISOString(),
    });
  } catch (error) {
    res.log.error(error);
    res
      .status(500)
      .send({ error: ErrorMessages.generic.SOMETHING_WENT_WRONG });
  }
};
