import typia from "typia";
import { RouteHandler } from "fastify";
import { DeploymentStatus, DeploymentStrategy, type JobDefinition } from "@nosana/kit";

import { ErrorMessages } from "../../../../../errors/index.js";
import { encryptWithKey } from "../../../../../vault/encrypt.js";
import { getExtractApiKeyFromHeader } from "../../../../helper/doesHeaderContainKey.js";
import { getOrCreateVault, storeVaultDocument, VaultNotFoundError } from "../../vaults/createSharedVault/createSharedVaultFactory.js";

import {
  createDeployment,
  hasExposedPorts,
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

  req.log.debug("Received deployment creation request from user %s with body: %o, headers: %o", userId, req.body, req.headers);

  const apiKey = getExtractApiKeyFromHeader(req.headers);

  try {
    if (!typia.validate<DeploymentCreateBody>(req.body).success) {
      res.status(400).send({ error: ErrorMessages.generic.INVALID_BODY });
      return;
    }

    if (req.body.strategy === DeploymentStrategy.INFINITE) {
      if (req.body.timeout < 60) {
        res.status(400).send({ error: ErrorMessages.deployments.INVALID_TIMEOUT });
        return;
      }

      if (req.body.rotation_time && req.body.rotation_time >= req.body.timeout - 10) {
        res.status(400).send({ error: ErrorMessages.deployments.INVALID_ROTATION_TIME });
        return;
      }

      if (req.body.startup_timeout && !hasExposedPorts(req.body.job_definition as JobDefinition)) {
        res.status(400).send({ error: ErrorMessages.deployments.STARTUP_TIMEOUT_WITHOUT_ENDPOINTS });
        return;
      }
    }

    let vault = req.body.vault

    if (!apiKey) {
      try {
        const resolved = await getOrCreateVault({
          owner: userId,
          targetVault: vault,
          createNew: req.body.new_vault,
        });
        vault = resolved.vault;
      } catch (error) {
        if (error instanceof VaultNotFoundError) {
          res.status(404).send({ error: ErrorMessages.vaults.NOT_FOUND });
          return;
        }
        res.status(500).send({ error: ErrorMessages.vaults.FAILED_TO_CREATE });
        return;
      }
    } else {
      vault = userId;
      const vaultKey = encryptWithKey(apiKey);

      const { acknowledged } = await storeVaultDocument(db.vaults, vault, vaultKey, vault);

      if (!acknowledged) {
        res.status(500).send({ error: ErrorMessages.vaults.FAILED_TO_CREATE });
        return;
      }
    }

    const created_at = new Date();

    const { deployment, revision } = await createDeployment(
      req.body,
      vault,
      userId,
      created_at
    );

    const { acknowledged: revisionAcknowledged } = await db.revisions.insertOne(revision);

    if (!revisionAcknowledged) {
      res.status(500).send({ error: ErrorMessages.deployments.FAILED_TO_CREATE_NEW_REVISION });
      return;
    }

    const { acknowledged } = await db.deployments.insertOne(deployment);

    if (!acknowledged) {
      res.status(500).send({ error: ErrorMessages.deployments.FAILED_TO_CREATE });
      return;
    }

    // Auto-start: move DRAFT -> STARTING via an update so the change-stream
    // listener schedules the first LIST task (listeners only react to updates).
    if (req.body.autostart) {
      await db.deployments.updateOne(
        { id: deployment.id, owner: userId },
        { $set: { status: DeploymentStatus.STARTING, updated_at: created_at } }
      );
      deployment.status = DeploymentStatus.STARTING;
    }

    res.status(200);
    return {
      ...deployment,
      active_jobs: 0,
      created_at: created_at.toISOString(),
      updated_at: created_at.toISOString(),
    };
  } catch (error) {
    res.log.error("Error creating deployment: %s", String(error));
    res.status(500).send({ error: ErrorMessages.generic.INTERNAL_SERVER_ERROR });
  }
};
