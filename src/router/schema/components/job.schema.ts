import { Static, Type } from "@sinclair/typebox";

import { PublicKeySchema } from "./publicKey.schema.js";

export const JobsSchema = Type.Object({
  job: PublicKeySchema,
  deployment: PublicKeySchema,
  tx: Type.String(),
  created_at: Type.String({ format: "date-time" }),
});

export type JobsSchema = Static<typeof JobsSchema>