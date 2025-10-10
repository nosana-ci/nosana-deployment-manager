import { Type } from "@sinclair/typebox";

import { PublicKeySchema } from "./publicKey.schema.js";

import { JobDefinitionSchema } from "./jobDefinition.schema.js";

export const RevisionSchema = Type.Object({
  revision: Type.Number(),
  deployment: PublicKeySchema,
  ipfs_definition_hash: Type.String(),
  job_definition: JobDefinitionSchema,
  created_at: Type.String({ format: "date-time" }),
});