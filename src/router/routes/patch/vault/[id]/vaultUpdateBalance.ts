import type { RouteHandler } from "fastify";
import { PublicKey } from "@solana/web3.js";

import { ErrorsMessages } from "../../../../../errors/index.js";
import { ConnectionSelector } from "../../../../../connection/solana.js";
import { getNosTokenAddressForAccount } from "../../../../../tokenManager/helpers/NOS/getNosTokenAddressForAccount.js";

import type { HeadersSchema } from "../../../../schema/index.schema.js";
import type {
  VaultUpdateBalanceError,
  VaultUpdateBalanceSuccess,
} from "../../../../schema/patch/vaults/[id]/vaultUpdateBalance.schema.js";

export const vaultUpdateBalanceHandler: RouteHandler<{
  Params: { vault: string };
  Headers: HeadersSchema;
  Response: VaultUpdateBalanceSuccess | VaultUpdateBalanceError;
}> = async (req, res) => {
  const { db } = res.locals;
  const vault = res.locals.vault!;
  const userId = req.headers["x-user-id"];

  try {
    const connection = ConnectionSelector();

    const [solBalance, { account, balance }] = await Promise.all([
      connection.getBalance(new PublicKey(vault.vault)),
      getNosTokenAddressForAccount(new PublicKey(vault.vault), connection),
    ]);

    const { acknowledged } = await db.vaults.updateOne(
      { vault: vault.vault, owner: userId },
      {
        $set: {
          sol: solBalance,
          nos: balance ?? 0,
          nos_ata: account.toString(),
        },
      }
    );

    if (!acknowledged) {
      res
        .status(500)
        .send({ error: ErrorsMessages.vaults.FAILED_TO_UPDATE_BALANCE });
      return;
    }

    res.status(200).send({
      SOL: solBalance,
      NOS: balance,
    });
  } catch (error) {
    res.log.error(error);
    res
      .status(500)
      .send({ error: ErrorsMessages.generic.SOMETHING_WENT_WRONG });
  }
};
