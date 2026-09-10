import { withTransaction } from "../../../../../repositories/index.js";
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

    // Insert both documents atomically: a duplicate key or failed revision leaves neither.
    await withTransaction(async (session) => {
      await db.deployments.insertOne(deployment, { session });
      await db.revisions.insertOne(revision, { session });

      // Keep the DRAFT -> STARTING update: the listener schedules work from updates.
      if (req.body.autostart) {
        await db.deployments.updateOne(
          { id: deployment.id, owner: userId },
          { $set: { status: DeploymentStatus.STARTING, updated_at: created_at } },
          { session },
        );
      }
    });

    if (req.body.autostart) deployment.status = DeploymentStatus.STARTING;

    const response = { ...deployment };
    delete response.idempotency_key;
    res.status(200);
    return {
      ...response,
      active_jobs: 0,
      created_at: created_at.toISOString(),
      updated_at: created_at.toISOString(),
    };
  } catch (error) {
    if (req.body.idempotency_key && (error as { code?: number }).code === 11000) {
      return res.status(409).send({ error: "A deployment with this idempotency key already exists" });
    }
    res.log.error("Error creating deployment: %s", String(error));
    res.status(500).send({ error: ErrorMessages.generic.INTERNAL_SERVER_ERROR });
  }
};
