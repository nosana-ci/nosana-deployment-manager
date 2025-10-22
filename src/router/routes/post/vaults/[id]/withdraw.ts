import type { RouteHandler } from "fastify";
import { Keypair } from "@solana/web3.js";

import { ErrorMessages } from "../../../../../errors/index.js";
import { TokenManager } from "../../../../../tokenManager/index.js";
import { covertStringToIterable } from "../../../../../tasks/utils/convertStringToIterable.js";

import type { HeadersSchema } from "../../../../schema/index.schema.js";
import type {
  VaultWithdrawBody,
  VaultWithdrawError,
  VaultWithdrawSuccess,
} from "../../../../schema/post/vaults/[id]/withdraw.schema.js";
import { decryptWithKey } from "../../../../../vault/decrypt.js";

export const vaultWithdrawHandler: RouteHandler<{
  Params: { vault: string };
  Headers: HeadersSchema;
  Body: VaultWithdrawBody;
  Response: VaultWithdrawSuccess | VaultWithdrawError;
}> = async (req, res) => {
  const vault = res.locals.vault!;
  const key = decryptWithKey(vault.vault_key);

  if (key.startsWith("nos_")) {
    res
      .status(400)
      .send({ error: ErrorMessages.vaults.WITHDRAW_NOSANA_API_KEY_VAULT });
    return;
  }

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
        new Uint8Array(covertStringToIterable(key))
      )
    );

    res.status(200).send({ transaction: tx });
  } catch (error) {
    res.log.error(error);
    res
      .status(500)
      .send({ error: ErrorMessages.generic.SOMETHING_WENT_WRONG });
  }
};
