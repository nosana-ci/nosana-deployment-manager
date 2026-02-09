import { validateJobDefinition } from "@nosana/kit";
import { FastifySchemaCompiler } from "fastify/types/schema.js";
import { Value } from "@sinclair/typebox/value";
import {
  DeploymentCreateBody,
  DeploymentMetadataSchema,
} from "../schema/post/deployments/deploymentCreate.schema.js";

export const deploymentCreateValidation: FastifySchemaCompiler<DeploymentCreateBody> =
  () => {
    return (data) => {
      // 1. Validate top-level fields using the metadata-only schema
      // This automatically ignores the job_definition field
      const metadataErrors = [...Value.Errors(DeploymentMetadataSchema, data)];

      if (metadataErrors.length > 0) {
        const message = metadataErrors
          .map((e) => `${e.path.replace(/^\//, "")}: ${e.message}`)
          .join(", ");
        return { error: new Error(message) };
      }

      // 2. Validate job_definition using the kit validator
      const result = validateJobDefinition(data.job_definition);

      if (!result.success) {
        const message = result.errors
          .map(
            (e: { path: string; expected: string }) =>
              `job_definition${e.path}: ${e.expected}`
          )
          .join(", ");
        return { error: new Error(message) };
      }

      return { value: data };
    };
  };
