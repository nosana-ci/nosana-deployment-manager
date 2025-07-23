import { Request } from "express";
import { Keypair } from "@solana/web3.js";

import { ErrorsMessages } from "../../../../../errors/index.js";
import { TokenManager } from "../../../../../tokenManager/index.js";
import { covertStringToIterable } from "../../../../../tasks/utils/convertStringToIterable.js";

import { VaultsResponse } from "../../../../../types.js";

export async function vaultWithdrawHandler(
  req: Request<{ vault: string }, unknown, { SOL?: number; NOS?: number }>,
  res: VaultsResponse,
) {
  const { vault } = res.locals;

  try {
    const tokenManager = new TokenManager(
      vault.vault,
      vault.owner,
      "DESTINATION",
    );

    await tokenManager.addSOL(req.body.SOL);
    await tokenManager.addNOS(req.body.NOS);

    const tx = await tokenManager.signAndSerialize(
      Keypair.fromSecretKey(
        new Uint8Array(covertStringToIterable(vault.vault_key)),
      ),
    );

    res.status(200).json({ transaction: tx });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ error: ErrorsMessages.generic.SOMETHING_WENT_WRONG });
  }
}
