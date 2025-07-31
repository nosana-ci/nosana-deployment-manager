import type { RouteHandler } from "fastify";
import { Keypair } from "@solana/web3.js";

import { ErrorsMessages } from "../../../../../errors/index.js";
import { TokenManager } from "../../../../../tokenManager/index.js";
import { covertStringToIterable } from "../../../../../tasks/utils/convertStringToIterable.js";

import type { HeadersSchema } from "../../../../schema/index.schema.js";
import type {
  VaultWithdrawBody,
  VaultWithdrawError,
  VaultWithdrawSuccess,
} from "../../../../schema/post/vaults/[id]/withdraw.schema.js";

export const vaultWithdrawHandler: RouteHandler<{
  Params: { vault: string };
  Headers: HeadersSchema;
  Body: VaultWithdrawBody;
  Response: VaultWithdrawSuccess | VaultWithdrawError;
}> = async (req, res) => {
  const vault = res.locals.vault!;

  try {
    const tokenManager = new TokenManager(
      vault.vault,
      vault.owner,
      "DESTINATION"
    );

    await tokenManager.addSOL(req.body.SOL);
    await tokenManager.addNOS(req.body.NOS);

    const tx = await tokenManager.signAndSerialize(
      Keypair.fromSecretKey(
        new Uint8Array(covertStringToIterable(vault.vault_key))
      )
    );

    res.status(200).send({ transaction: tx });
  } catch (error) {
    res.log.error(error);
    res
      .status(500)
      .send({ error: ErrorsMessages.generic.SOMETHING_WENT_WRONG });
  }
};
