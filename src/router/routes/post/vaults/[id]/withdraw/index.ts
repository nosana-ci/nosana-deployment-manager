import type { RouteHandler } from "fastify";

import { VaultWorker } from "../../../../../../worker/Worker.js";
import { ErrorMessages } from "../../../../../../errors/index.js";
import { decryptWithKey } from "../../../../../../vault/decrypt.js";

import type { HeadersSchema } from "../../../../../schema/index.schema.js";
import type {
  VaultWithdrawBody,
  VaultWithdrawError,
  VaultWithdrawSuccess,
} from "../../../../../schema/post/vaults/[id]/withdraw.schema.js";

export const vaultWithdrawHandler: RouteHandler<{
  Params: { vault: string };
  Headers: HeadersSchema;
  Body: VaultWithdrawBody;
  Response: VaultWithdrawSuccess | VaultWithdrawError;
}> = async (_, res) => {
  const vault = res.locals.vault!;
  const key = decryptWithKey(vault.vault_key);

  if (key.startsWith("nos_")) {
    res
      .status(400)
      .send({ error: ErrorMessages.vaults.WITHDRAW_NOSANA_API_KEY_VAULT });
    return;
  }

  const worker = new VaultWorker("../router/routes/post/vaults/[id]/withdraw/worker.js", {
    workerData: {
      owner: vault.owner,
      vault: vault.vault_key,
    }
  })

  return new Promise<void>((resolve) => {
    worker.on("message", ({ event, data, error }: { event: string; data: string | null; error: string | null }) => {
      if (event === "SUCCESS") {
        if (data === null) {
          res.status(500).send({ error: ErrorMessages.vaults.WITHDRAW_NO_FUNDS });
          resolve();
          return;
        }

        res.status(200).send({ transaction: data! });
        resolve();
        return;
      }
      if (event === "ERROR") {
        res.log.error(`Vault Withdraw Error: ${error}`);
        res
          .status(500)
          .send({ error: ErrorMessages.generic.SOMETHING_WENT_WRONG });
        resolve();
        return;
      }

      worker.terminate();
    })
  });
};
