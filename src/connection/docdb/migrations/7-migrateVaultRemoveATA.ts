import { Db } from "mongodb";

import type { VaultDocument } from "../../../types/index.js";

/**
 *  Now that ATA accounts are no longer used for NOS token management, this migration removes the nos_ata field from vault documents.
 */
export default async function migrateVaultRemoveATA(db: Db) {
  db.collection<VaultDocument & { nos_ata: string | undefined }>("vaults").updateMany(
    {
      nos_ata: { $exists: true },
    },
    { $unset: { nos_ata: "" } }
  );
}
