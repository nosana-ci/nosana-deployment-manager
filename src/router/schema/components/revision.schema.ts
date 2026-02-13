import { Type } from "@sinclair/typebox";

import { PublicKeySchema } from "./publicKey.schema.js";

export const RevisionSchema = Type.Object({
  revision: Type.Number(),
  deployment: PublicKeySchema,
  ipfs_definition_hash: Type.String(),
  job_definition: Type.Ref("JobDefinition"),
  created_at: Type.String({ format: "date-time" }),
});