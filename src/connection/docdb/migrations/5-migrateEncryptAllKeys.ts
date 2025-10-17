import { Db } from "mongodb";
import { PublicKey } from "@solana/web3.js";

import { encryptWithKey } from "../../../vault/encrypt.js";

import type { VaultCollection } from "../../../types/index.js";

function isPublicKey(key: string): boolean {
  try {
    new PublicKey(key);
    return true;
  } catch {
    return false;
  }
}


export default async function migrateDeploymentsToEndpoints(db: Db) {
  const vaults = await (db.collection("vaults") as VaultCollection).find().toArray();

  for (const { vault, vault_key } of vaults) {
    if (!isPublicKey(vault)) continue;

    const { acknowledged } = await (db.collection("vaults") as VaultCollection).updateOne({
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
