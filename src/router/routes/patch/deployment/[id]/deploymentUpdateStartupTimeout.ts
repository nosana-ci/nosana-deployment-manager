import type { RouteHandler } from "fastify";

import { ErrorMessages } from "../../../../../errors/index.js";

import type { HeadersSchema } from "../../../../schema/index.schema.js";
import type {
  DeploymentUpdateStartupTimeoutError,
  DeploymentUpdateStartupTimeoutSuccess,
} from "../../../../schema/patch/index.schema.js";

import { DeploymentStrategy } from "../../../../../types/index.js";

/**
 * Updates the owner-set startup timeout of an INFINITE deployment. The field is
 * only read by `armStartupDeadline` when a job reaches RUNNING, so the new value
 * simply applies to jobs started after the update — no reconciliation of jobs
 * already running (or their armed deadlines) is needed.
 */
export const deploymentUpdateStartupTimeoutHandler: RouteHandler<{
  Body: { startup_timeout: number };
  Params: { deployment: string };
  Headers: HeadersSchema;
  Reply: DeploymentUpdateStartupTimeoutSuccess | DeploymentUpdateStartupTimeoutError;
}> = async (req, res) => {
  const { db } = res.locals;
  const startup_timeout = req.body.startup_timeout;
  const deployment = res.locals.deployment!;
  const userId = req.headers["x-user-id"];

  if (deployment.strategy !== DeploymentStrategy.INFINITE) {
    res.status(400).send({
      error: ErrorMessages.deployments.INCORRECT_STRATEGY,
    });
    return;
  }

  if (!deployment.endpoints.length) {
    res.status(400).send({
      error: ErrorMessages.deployments.STARTUP_TIMEOUT_WITHOUT_ENDPOINTS,
    });
    return;
  }

  try {
    const updated_at = new Date();
    const { acknowledged } = await db.deployments.updateOne(
      {
        id: { $eq: deployment.id },
        owner: { $eq: userId },
        startup_timeout: { $ne: startup_timeout },
      },
      {
        $set: {
          startup_timeout,
          updated_at,
        },
      }
    );

    if (!acknowledged) {
      res.status(500).send({
        error: ErrorMessages.deployments.FAILED_STARTUP_TIMEOUT_UPDATE,
      });
      return;
    }

    res.status(200).send({
      startup_timeout,
      updated_at: updated_at.toISOString(),
    });
  } catch (error) {
    res.log.error(error);
    res
      .status(500)
      .send({ error: ErrorMessages.generic.SOMETHING_WENT_WRONG });
  }
};
