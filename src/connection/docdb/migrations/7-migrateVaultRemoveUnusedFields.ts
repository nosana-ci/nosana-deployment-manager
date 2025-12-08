import type { Db } from "mongodb";

import type { VaultDocument } from "../../../types/index.js";

/**
 *  Now that ATA accounts are no longer used for NOS token management,
 *  this migration removes the nos_ata and other unused fields from vault documents.
 */
export default async function migrateVaultRemoveUnusedFields(db: Db) {
  await db.collection<VaultDocument>("vaults").updateMany(
    {
      $or: [
        { nos: { $exists: true } },
        { sol: { $exists: true } },
        { nos_ata: { $exists: true } },
        { updated_at: { $exists: true } }
      ]
    },
    { $unset: { nos_ata: "", nos: "", sol: "", updated_at: "" } }
  );
}
