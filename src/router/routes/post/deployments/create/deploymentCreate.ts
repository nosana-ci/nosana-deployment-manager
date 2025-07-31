import typia from "typia";
import { RouteHandler } from "fastify";

import {
  createAndStoreVault,
  createDeployment,
} from "./deploymentCreate.factory.js";

import type {
  DeploymentCreateBody,
  DeploymentCreateError,
  DeploymentCreateSuccess,
} from "../../../../schema/post/index.schema.js";
import type { HeadersSchema } from "../../../../schema/index.schema.js";

export const deploymentCreateHandler: RouteHandler<{
  Headers: HeadersSchema;
  Body: DeploymentCreateBody;
  Reply: DeploymentCreateSuccess | DeploymentCreateError;
}> = async (req, res) => {
  const { db } = res.locals;
  const userId = req.headers["x-user-id"];

  try {
    if (!typia.validate<DeploymentCreateBody>(req.body).success) {
      res.status(400).send({ error: "Invalid request body" });
      return;
    }

    const created_at = new Date();

    const vault = await createAndStoreVault(userId, created_at);
    const { acknowledged: vaultAcknowledged } = await db.vaults.insertOne(
      vault
    );

    if (!vaultAcknowledged) {
      res.status(500).send({ error: "Failed to create deployment vault" });
      return;
    }

    const deployment = createDeployment(
      req.body,
      vault.vault,
      userId,
      created_at
    );
    const { acknowledged } = await db.deployments.insertOne(deployment);

    if (!acknowledged) {
      res.status(500).send({ error: "Failed to create deployment" });
      return;
    }

    Reflect.deleteProperty(deployment, "_id");
    res.status(201);
    return {
      ...deployment,
      events: [],
      jobs: [],
      created_at: created_at.toISOString(),
      updated_at: created_at.toISOString(),
    };
  } catch (error) {
    res.log.error("Error creating deployment:", error);
    res.status(500).send({ error: "Internal Server Error" });
  }
};
