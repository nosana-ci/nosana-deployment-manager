import { Request } from "express";
import { PublicKey } from "@solana/web3.js";

import { ErrorsMessages } from "../../../../../errors/index.js";
import { ConnectionSelector } from "../../../../../connection/solana.js";
import { getNosTokenAddressForAccount } from "../../../../../tokenManager/helpers/NOS/getNosTokenAddressForAccount.js";

import { VaultsResponse } from "../../../../../types.js";

export async function vaultUpdateBalanceHandler(
  req: Request<{ vault: string }>,
  res: VaultsResponse,
) {
  const { db, vault } = res.locals;
  const userId = req.headers["x-user-id"] as string;

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
      },
    );

    if (!acknowledged) {
      res
        .status(500)
        .json({ error: ErrorsMessages.vaults.FAILED_TO_UPDATE_BALANCE });
      return;
    }

    res.status(200).json({
      SOL: solBalance,
      NOS: balance,
    });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ error: ErrorsMessages.generic.SOMETHING_WENT_WRONG });
  }
}
