import { generateVault } from "../../../../../vault/generate.js";
import { getRepository } from "../../../../../repositories/index.js";
import { NosanaCollections } from "../../../../../definitions/collection.js";
import { ErrorMessages } from "../../../../../errors/index.js";
import type { VaultCollection, VaultDocument } from "../../../../../types/index.js";
import type { CreateSharedVaultSuccess } from "../../../../schema/post/index.schema.js";

type StoreVault = Promise<{
  acknowledged: boolean;
  upserted: boolean;
  vault: CreateSharedVaultSuccess
}>;

/** Thrown when a requested vault does not exist or is not owned by the caller. */
export class VaultNotFoundError extends Error {
  constructor() {
    super(ErrorMessages.vaults.NOT_FOUND);
    this.name = "VaultNotFoundError";
  }
}

function createVaultDocument(vault: string, vault_key: string, owner: string, created_at: Date): VaultDocument {
  return {
    vault,
    vault_key,
    owner,
    created_at
  };
}

function toVaultResponse({ vault, owner, created_at }: VaultDocument): CreateSharedVaultSuccess {
  return { vault, owner, created_at: created_at.toISOString() };
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
    vault: toVaultResponse(vaultObj),
  };
}

type GetOrCreateVaultOptions = {
  owner: string;
  created_at?: Date;
  /** Use this specific owned vault; throws VaultNotFoundError if not owned. */
  targetVault?: string;
  /** Mint a brand-new vault instead of reusing the shared (oldest) one. */
  createNew?: boolean;
};

/**
 * Resolves the vault a deployment (or vault-create request) should use:
 *
 * - `targetVault` set → that vault, verified to be owned by `owner`
 * - `createNew` set   → a freshly generated vault
 * - neither (default) → the owner's shared vault: their oldest vault,
 *   created if none exists yet
 *
 * API-key vault documents (stored with `vault === owner`, holding an encrypted
 * Nosana API key instead of a Solana keypair) are excluded from shared-vault
 * selection — picking one would make workers treat a wallet deployment as an
 * API-key deployment.
 *
 * Throws VaultNotFoundError for an unknown/unowned `targetVault`, and a plain
 * Error when persisting a new vault fails.
 */
export async function getOrCreateVault({
  owner,
  created_at = new Date(),
  targetVault,
  createNew = false,
}: GetOrCreateVaultOptions): Promise<CreateSharedVaultSuccess> {
  const { findOne, collection } = getRepository(NosanaCollections.VAULTS);

  if (targetVault) {
    // `targetVault === owner` would match the owner's API-key vault document
    // (which holds an encrypted API key, not a keypair) — never selectable
    // for signer-auth deployments.
    if (targetVault === owner) {
      throw new VaultNotFoundError();
    }

    const existing = await findOne({ owner, vault: targetVault });

    if (!existing) {
      throw new VaultNotFoundError();
    }

    return toVaultResponse(existing);
  }

  if (!createNew) {
    const existing = await findOne(
      { owner, vault: { $ne: owner } },
      { sort: { created_at: 1, vault: 1 } }
    );

    if (existing) {
      return toVaultResponse(existing);
    }
  }

  const [publicKey, privateKey] = await generateVault();
  const { acknowledged, vault } = await storeVaultDocument(collection, publicKey, privateKey, owner, created_at);

  if (!acknowledged) {
    throw new Error(ErrorMessages.vaults.FAILED_TO_CREATE);
  }

  return vault;
}
