import { validateJobDefinition } from "@nosana/kit";
import { FastifySchemaCompiler } from "fastify/types/schema.js";
import { Value } from "@sinclair/typebox/value";
import {
  DeploymentCreateBody,
  DeploymentCreateBodySchema,
} from "../schema/post/deployments/deploymentCreate.schema.js";

export const deploymentCreateValidation: FastifySchemaCompiler<DeploymentCreateBody> =
  () => {
    return (data: DeploymentCreateBody) => {
      // 1. Validate top-level fields using the existing TypeBox schema
      const errors = [...Value.Errors(DeploymentCreateBodySchema, data)];

      // Filter out errors that come from job_definition since we validate that separately
      const filteredErrors = errors.filter(
        (e) => !e.path.startsWith("/job_definition")
      );

      if (filteredErrors.length > 0) {
        const message = filteredErrors
          .map((e) => `${e.path}: ${e.message}`)
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
