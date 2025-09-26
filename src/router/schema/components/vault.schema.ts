import { Static, Type } from "@sinclair/typebox";

import { PublicKeySchema } from "./publicKey.schema.js";

export const VaultSchema = Type.Object({
  vault: PublicKeySchema,
  owner: PublicKeySchema,
  created_at: Type.String({ format: "date-time" }),
})
export const VaultsSchema = Type.Array(VaultSchema);

export type VaultSchema = Static<typeof VaultSchema>;
export type VaultsSchema = Static<typeof VaultsSchema>;
