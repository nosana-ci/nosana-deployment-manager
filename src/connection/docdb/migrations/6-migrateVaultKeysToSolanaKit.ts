import type { Db } from "mongodb";
import { isAddress } from "@solana/addresses";
import { decryptWithKey, encryptWithKey } from "../../../vault/index.js";
import { convertStringToUint8Array } from "../../../tasks/utils/convertStringToUint8Array.js";

import type { VaultDocument } from "../../../types/index.js";

/**
 * Migrates web3.js vaults keys was a concat of [privateKey, publicKey] to SolanaKit encrypted keys.
 * This removes the publicKey from the stored vault key only storing the first 32 bytes (the privateKey).
 */
export default async function migrateVaultKeysToSolanaKit(db: Db) {
  const vaults = await db.collection<VaultDocument>("vaults").find().toArray();

  for (const { vault, vault_key } of vaults) {
    if (!isAddress(vault)) continue;

    const key = decryptWithKey(vault_key);
    if (key.startsWith("nos_")) continue;

    const { acknowledged } = await db.collection<VaultDocument>("vaults").updateOne({
      vault: {
        $eq: vault
      }
    }, {
      $set: {
        vault_key: encryptWithKey(convertStringToUint8Array(key).slice(0, 32).toString())
      }
    });

    if (!acknowledged) {
      throw new Error(`Failed encrypt vault key for vault ${vault}`);
    }
  }
}
