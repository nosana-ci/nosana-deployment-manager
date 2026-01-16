import { generateVault } from "../../../../../vault/generate.js";
import type { VaultCollection, VaultDocument } from "../../../../../types/index.js";
import type { CreateSharedVaultSuccess } from "../../../../schema/post/index.schema.js";

type StoreVault = Promise<{
  acknowledged: boolean;
  upserted: boolean;
  vault: CreateSharedVaultSuccess
}>;

function createVaultDocument(vault: string, vault_key: string, owner: string, created_at: Date): VaultDocument {
  return {
    vault,
    vault_key,
    owner,
    created_at
  };
}

export async function storeVaultDocument(vaults: VaultCollection, vault: string, vault_key: string, owner: string, created_at: Date = new Date()): StoreVault {
  const vaultObj = createVaultDocument(vault, vault_key, owner, created_at);

  const result = await vaults.updateOne(
    { vault: vaultObj.vault },
    { $setOnInsert: vaultObj },
    { upsert: true }
  );

  const acknowledged = result.acknowledged && (result.upsertedCount > 0 || result.matchedCount > 0);

  return {
    acknowledged,
    upserted: result.upsertedCount > 0,
    vault: {
      vault: vaultObj.vault,
      owner: vaultObj.owner,
      created_at: vaultObj.created_at.toISOString(),
    }
  };
}

export async function createAndStoreSharedVault(
  vaults: VaultCollection,
  owner: string,
  created_at: Date
): StoreVault {
  const [publicKey, privateKey] = await generateVault();

  const result = await storeVaultDocument(vaults, publicKey, privateKey, owner, created_at);
  return result;
}
