import { jobSchemas } from "@nosana/sdk";
import type { Static, TSchema } from "@sinclair/typebox";

import { flattenSchema, SchemaObject } from "./utils/flattenSchema.js";

export const JobResultsSchema: TSchema = {
  ...flattenSchema(
    jobSchemas.components.schemas!.FlowState as TSchema,
    jobSchemas.components.schemas as Record<string, SchemaObject>
  )
}


export type JobResultsSchema = Static<typeof JobResultsSchema>