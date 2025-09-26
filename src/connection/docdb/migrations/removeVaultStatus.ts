import { Db } from "mongodb";

import { VaultCollection } from "../../../types/index.js";

export default async function removeVaultStatus(db: Db) {
  db.collection<VaultCollection>("vault").updateMany(
    {
      status: { $exists: true },
    },
    {
      $unset: {
        status: ""
      }
    }
  );
}
