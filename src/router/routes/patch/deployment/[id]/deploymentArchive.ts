import type { RouteHandler } from "fastify";
import { Wallet } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";

import { Vault } from "../../../../../vault/index.js";
import { ErrorsMessages } from "../../../../../errors/index.js";
import { DeploymentStatus, VaultStatus } from "../../../../../types/index.js";

import type { HeadersSchema } from "../../../../schema/index.schema.js";
import type {
  DeploymentArchiveError,
  DeploymentArchiveSuccess,
} from "../../../../schema/patch/deployments/[id]/deploymentArchive.schema.js";

export const deploymentArchiveHandler: RouteHandler<{
  Params: { deployment: string };
  Headers: HeadersSchema;
  Reply: DeploymentArchiveSuccess | DeploymentArchiveError;
}> = async (req, res) => {
  const { db } = res.locals;
  const deployment = res.locals.deployment!;
  const userId = req.headers["x-user-id"];

  try {
    if (deployment.status !== "STOPPED") {
      res
        .status(500)
        .send({ error: ErrorsMessages.deployments.INCORRECT_STATE });
      return;
    }

    const vault = new Vault(
      new PublicKey(deployment.vault),
      new Wallet(new Keypair())
    );

    const { SOL, NOS } = await vault.getBalance();

    if (SOL !== 0 || NOS !== 0) {
      res.status(500).send({
        error: ErrorsMessages.vaults.NOT_EMPTY,
      });
      return;
    }

    const { acknowledged } = await db.vaults.updateOne(
      {
        id: { $eq: deployment.vault },
        owner: { $eq: userId },
      },
      {
        $set: {
          status: VaultStatus.ARCHIVED,
        },
      }
    );

    if (!acknowledged) {
      res.status(500).send({
        error: ErrorsMessages.vaults.FAILED_TO_ARCHIVE,
      });
      return;
    }

    const { acknowledged: acknowledgedDeployments } =
      await db.deployments.updateOne(
        {
          id: { $eq: deployment.id },
          owner: { $eq: userId },
        },
        {
          $set: {
            status: DeploymentStatus.ARCHIVED,
          },
        }
      );

    if (!acknowledgedDeployments) {
      res
        .status(500)
        .send({ error: ErrorsMessages.deployments.FAILED_TO_ARCHIVE });
      return;
    }

    res.status(200).send();
  } catch (error) {
    res.log.error(error);
    res
      .status(500)
      .send({ error: ErrorsMessages.generic.SOMETHING_WENT_WRONG });
  }
};
