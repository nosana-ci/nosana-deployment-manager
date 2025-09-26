import solana from "@solana/web3.js";

import { ConnectionSelector } from "../../../../../connection/index.js";
import { getNosTokenAddressForAccount } from "../../../../../tokenManager/helpers/NOS/getNosTokenAddressForAccount.js";

import { VaultCollection } from "../../../../../types/index.js";
import { CreateSharedVaultSuccess } from "../../../../schema/post/index.schema.js";

export async function createAndStoreSharedVault(
  vaults: VaultCollection,
  owner: string,
  created_at: Date
): Promise<{
  acknowledged: boolean;
  vault: CreateSharedVaultSuccess
}> {
  const connection = ConnectionSelector();
  const vault = solana.Keypair.generate();

  const { account } = await getNosTokenAddressForAccount(
    vault.publicKey,
    connection
  );

  const vaultObj = {
    vault: vault.publicKey.toString(),
    vault_key: vault.secretKey.toString(),
    owner,
    sol: 0,
    nos: 0,
    nos_ata: account.toString(),
    created_at,
    updated_at: created_at,
  }

  const { acknowledged } = await vaults.insertOne(
    vaultObj
  );

  return {
    acknowledged,
    vault: {
      vault: vaultObj.vault,
      owner: vaultObj.owner,
      created_at: vaultObj.created_at.toISOString(),
    }
  }
}