import type { RouteHandler } from "fastify";

import { ErrorMessages } from "../../../../../errors/index.js";

import type { HeadersSchema } from "../../../../schema/index.schema.js";
import type {
  DeploymentUpdateReplicaCountError,
  DeploymentUpdateReplicaCountSuccess,
} from "../../../../schema/patch/index.schema.js";

export const deploymentUpdateReplicaCountHandler: RouteHandler<{
  Body: { replicas: number };
  Params: { deployment: string };
  Headers: HeadersSchema;
  Reply:
  | DeploymentUpdateReplicaCountSuccess
  | DeploymentUpdateReplicaCountError;
}> = async (req, res) => {
  const { db } = res.locals;
  const replicas = req.body.replicas;
  const userId = req.headers["x-user-id"];
  const deployment = res.locals.deployment!;

  const updated_at = new Date();

  try {
    const { acknowledged } = await db.deployments.updateOne(
      {
        id: { $eq: deployment.id },
        owner: { $eq: userId },
        replicas: { $ne: replicas },
      },
      {
        $set: {
          replicas,
          updated_at,
        },
      }
    );

    if (!acknowledged) {
      res.status(500).send({
        error: ErrorMessages.deployments.FAILED_REPLICA_COUNT_UPDATE,
      });
      return;
    }

    res.status(200).send({
      replicas,
      updated_at: updated_at.toISOString(),
    });
  } catch (error) {
    res.log.error(error);
    res
      .status(500)
      .send({ error: ErrorMessages.generic.SOMETHING_WENT_WRONG });
  }
};
