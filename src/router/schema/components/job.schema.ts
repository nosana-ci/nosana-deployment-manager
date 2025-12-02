import { Static, Type } from "@sinclair/typebox";

import { PublicKeySchema } from "./publicKey.schema.js";
import { JobState } from "../../../types/index.js";

export const JobsSchema = Type.Object({
  tx: Type.String(),
  job: PublicKeySchema,
  deployment: PublicKeySchema,
  revision: Type.Number({ minimum: 1 }),
  state: Type.Union([Type.Literal(JobState.QUEUED), Type.Literal(JobState.RUNNING), Type.Literal(JobState.COMPLETED), Type.Literal(JobState.STOPPED)]),
  created_at: Type.String({ format: "date-time" }),
  updated_at: Type.String({ format: "date-time" }),
});

export type JobsSchema = Static<typeof JobsSchema>