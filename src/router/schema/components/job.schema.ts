import { Static, Type } from "@sinclair/typebox";

import { PublicKeySchema } from "./publicKey.schema.js";

export const JobsSchema = Type.Object({
  tx: Type.String(),
  job: PublicKeySchema,
  deployment: PublicKeySchema,
  status: Type.Union([Type.Literal("PENDING"), Type.Literal("CONFIRMED"), Type.Literal("COMPLETED")]),
  created_at: Type.String({ format: "date-time" }),
});

export type JobsSchema = Static<typeof JobsSchema>