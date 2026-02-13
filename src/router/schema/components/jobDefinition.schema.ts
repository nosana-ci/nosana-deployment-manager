import { jobSchemas } from "@nosana/kit";
import { TSchema } from "@sinclair/typebox";

import { flattenSchema, SchemaObject } from "./utils/flattenSchema.js";

// Make the schemas mutually exclusive
// @ts-expect-error - Runtime schema manipulation, types are correct at runtime
if (jobSchemas.components.schemas?.OperationkeyofOperationArgsMap?.properties?.args?.oneOf) {
  // @ts-expect-error - Runtime schema manipulation, types are correct at runtime
  const argsOneOf = jobSchemas.components.schemas.OperationkeyofOperationArgsMap.properties.args.oneOf;

  // First schema (container/run) - add constraint to forbid 'name'
  if (argsOneOf[0]) {
    argsOneOf[0].not = {
      type: 'object',
      required: ['name']
    };

    // Enforce mutual exclusivity for resources S3 variants in container/run args
    const oneOfPath = argsOneOf[0]?.properties?.resources?.items?.oneOf;
    if (Array.isArray(oneOfPath)) {
      const wrap = (orig: unknown, extra: unknown) => ({ allOf: [orig, extra] });

      // 0: S3 base (no bucket/buckets)
      if (oneOfPath[0]) {
        oneOfPath[0] = wrap(oneOfPath[0], {
          type: 'object',
          not: {
            anyOf: [
              { type: 'object', required: ['bucket'] },
              { type: 'object', required: ['buckets'] }
            ]
          }
        });
      }
      // 1: S3 with bucket (must have bucket, no buckets; optional url OK)
      if (oneOfPath[1]) {
        oneOfPath[1] = wrap(oneOfPath[1], {
          type: 'object',
          required: ['bucket'],
          not: {
            anyOf: [
              { type: 'object', required: ['buckets'] },
              { type: 'object', required: ['files'] }
            ]
          }
        });
      }
      // 2: S3 with buckets (must have buckets, no bucket)
      if (oneOfPath[2]) {
        oneOfPath[2] = wrap(oneOfPath[2], {
          type: 'object',
          required: ['buckets'],
          not: {
            anyOf: [
              { type: 'object', required: ['bucket'] },
              { type: 'object', required: ['files'] }
            ]
          }
        });
      }
    }
  }

  // Second schema (container/create-volume) - ensure it requires 'name' and forbids 'image'
  if (argsOneOf[1]) {
    argsOneOf[1].required = ['name'];
    argsOneOf[1].not = {
      type: 'object',
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