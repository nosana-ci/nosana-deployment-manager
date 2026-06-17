import type { Collection } from "mongodb";

export type VaultDocument = {
  vault: string;
  vault_key: string;
  owner: string;
  created_at: Date;
};

export type VaultCollection = Collection<VaultDocument>;
