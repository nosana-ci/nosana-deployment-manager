import { Request } from "express";

import { ErrorsMessages } from "../../../../../errors/index.js";

import { DeploymentsResponse } from "../../../../../types.js";

export async function deploymentUpdateReplicaCountHandler(
  req: Request<{ deployment: string }, unknown, { replicas: number }>,
  res: DeploymentsResponse
) {
  const { db, deployment } = res.locals;

  const replicas = req.body.replicas;
  const updated_at = new Date();
  const userId = req.headers["x-user-id"] as string;

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
      res.status(500).json({
        error: ErrorsMessages.deployments.FAILED_REPLICA_COUNT_UPDATE,
      });
      return;
    }

    res.status(200).json({
      replicas,
      updated_at,
    });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ error: ErrorsMessages.generic.SOMETHING_WENT_WRONG });
  }
}
