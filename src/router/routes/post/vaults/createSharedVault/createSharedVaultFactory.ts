import solana from "@solana/web3.js";

import { ConnectionSelector } from "../../../../../connection/index.js";
import { getNosTokenAddressForAccount } from "../../../../../tokenManager/helpers/NOS/getNosTokenAddressForAccount.js";

import { VaultCollection, VaultDocument } from "../../../../../types/index.js";
import { CreateSharedVaultSuccess } from "../../../../schema/post/index.schema.js";
import { encryptWithKey } from "../../../../../vault/encrypt.js";

type StoreVault = Promise<{
  acknowledged: boolean;
  vault: CreateSharedVaultSuccess
}>;

function createVaultDocument(vault: string, vault_key: string, owner: string, created_at: Date, nos_ata: string | undefined): VaultDocument {
  return {
    vault,
    vault_key: encryptWithKey(vault_key),
    owner,
    sol: 0,
    nos: 0,
    nos_ata: nos_ata ?? "",
    created_at,
    updated_at: created_at,
  };
}

export async function storeVaultDocument(vaults: VaultCollection, vault: string, vault_key: string, owner: string, created_at: Date = new Date(), nos_ata?: string | undefined): StoreVault {
  const vaultObj = createVaultDocument(vault, vault_key, owner, created_at, nos_ata);

  const result = await vaults.updateOne(
    { vault: vaultObj.vault },
    { $setOnInsert: vaultObj },
    { upsert: true }
  );

  const acknowledged = result.acknowledged && (result.upsertedCount > 0 || result.matchedCount > 0);

  return {
    acknowledged,
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
  const connection = ConnectionSelector();
  const vault = solana.Keypair.generate();

  const { account } = await getNosTokenAddressForAccount(
    vault.publicKey,
    connection
  );

  const result = await storeVaultDocument(vaults, vault.publicKey.toString(), vault.secretKey.toString(), owner, created_at, account.toString());

  return result;
}