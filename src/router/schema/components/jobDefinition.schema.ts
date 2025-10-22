import { jobSchemas } from "@nosana/sdk";
import { TSchema } from "@sinclair/typebox";

import { flattenSchema, SchemaObject } from "./utils/flattenSchema.js";

// Make the schemas mutually exclusive
// @ts-expect-error expected type
if (jobSchemas.components.schemas?.OperationkeyofOperationArgsMap?.properties?.args?.oneOf) {
  // @ts-expect-error expected type
  const argsOneOf = jobSchemas.components.schemas.OperationkeyofOperationArgsMap.properties.args.oneOf;

  // First schema (container/run) - add constraint to forbid 'name'
  if (argsOneOf[0]) {
    argsOneOf[0].not = {
      properties: {
        name: true
      },
      required: ['name']
    };
  }

  // Second schema (container/create-volume) - ensure it requires 'name' and forbids 'image'
  if (argsOneOf[1]) {
    argsOneOf[1].required = ['name'];
    argsOneOf[1].not = {
      properties: {
        image: true
      },
      required: ['image']
    };
  }
}

export const JobDefinitionSchema: TSchema = {
  ...flattenSchema(
    jobSchemas.components.schemas!.JobDefinition as TSchema,
    jobSchemas.components.schemas as Record<string, SchemaObject>
  )
}