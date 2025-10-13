import typia from "typia";
import { RouteHandler } from "fastify";

import { ErrorMessages } from "../../../../../errors/index.js";
import { doesHeaderContainerKey } from "../../../../helper/doesHeaderContainKey.js";
import { createAndStoreSharedVault, storeVaultDocument } from "../../vaults/createSharedVault/createSharedVaultFactory.js";

import {
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

  const isNosanaApiRequest = doesHeaderContainerKey(req.headers);

  try {
    if (!typia.validate<DeploymentCreateBody>(req.body).success) {
      res.status(400).send({ error: ErrorMessages.generic.INVALID_BODY });
      return;
    }

    let vault = req.body.vault

    if (!isNosanaApiRequest) {
      if (vault) {
        const vaultfound = await db.vaults.findOne({ owner: userId, vault });

        if (!vaultfound) {
          res.status(404).send({ error: ErrorMessages.vaults.NOT_FOUND });
          return;
        }
      } else {
        const { vault: sharedVault, acknowledged } = await createAndStoreSharedVault(db.vaults, userId, new Date());
        if (!acknowledged) {
          res.status(500).send({ error: ErrorMessages.vaults.FAILED_TO_CREATE });
          return;
        }
        vault = sharedVault.vault;
      }
    } else {
      vault = userId;

      const { acknowledged } = await storeVaultDocument(db.vaults, userId, req.headers.authorization, userId);

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
      res.status(500).send({ error: ErrorMessages.deployments.REVISIONS.FAILED_TO_CREATE });
      return;
    }

    const { acknowledged } = await db.deployments.insertOne(deployment);

    if (!acknowledged) {
      res.status(500).send({ error: ErrorMessages.deployments.FAILED_TO_CREATE });
      return;
    }

    res.status(200);
    return {
      ...deployment,
      events: [],
      jobs: [],
      revisions: [
        {
          ...revision,
          created_at: revision.created_at.toISOString()
        },
      ],
      created_at: created_at.toISOString(),
      updated_at: created_at.toISOString(),
    };
  } catch (error) {
    res.log.error("Error creating deployment:", error);
    res.status(500).send({ error: ErrorMessages.generic.INTERNAL_SERVER_ERROR });
  }
};
