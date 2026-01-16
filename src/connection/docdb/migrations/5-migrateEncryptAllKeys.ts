import { Db } from "mongodb";
import { isAddress } from "@solana/addresses";

import { encryptWithKey } from "../../../vault/encrypt.js";

import type { VaultDocument } from "../../../types/index.js";

export default async function migrateDeploymentsToEndpoints(db: Db) {
  const vaults = await db.collection<VaultDocument>("vaults").find().toArray();

  for (const { vault, vault_key } of vaults) {
    if (!isAddress(vault)) continue;

    const { acknowledged } = await db.collection<VaultDocument>("vaults").updateOne({
      vault: {
        $eq: vault
      }
    }, {
      $set: {
        vault_key: encryptWithKey(vault_key)
      }
    });

    if (!acknowledged) {
      throw new Error(`Failed encrypt vault key for vault ${vault}`);
    }
  }
}
