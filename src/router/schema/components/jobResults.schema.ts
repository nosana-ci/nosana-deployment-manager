import { jobSchemas } from "@nosana/kit";
import type { Static, TSchema } from "@sinclair/typebox";

import { flattenSchema, SchemaObject } from "./utils/flattenSchema.js";

const flattenedSchema = flattenSchema(
  jobSchemas.components.schemas!.FlowState as TSchema,
  jobSchemas.components.schemas as Record<string, SchemaObject>
);

if (flattenedSchema.properties?.opStates?.items?.properties?.logs?.items) {
  const logItem = flattenedSchema.properties.opStates.items.properties.logs.items;
  if (logItem.required && Array.isArray(logItem.required)) {
    logItem.required = logItem.required.filter((field: string) => field !== 'timestamp');
  }
}

export const JobResultsSchema: TSchema = flattenedSchema;

export type JobResultsSchema = Static<typeof JobResultsSchema>