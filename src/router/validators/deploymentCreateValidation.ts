import { validateJobDefinition, type JobDefinition } from "@nosana/kit";
import { FastifySchemaCompiler } from "fastify/types/schema.js";
import { Value } from "@sinclair/typebox/value";
import {
  DeploymentCreateBody,
  DeploymentMetadataSchema,
} from "../schema/post/deployments/deploymentCreate.schema.js";
import { FastifySchema } from "fastify";

import { validateJobDefinitionSshKeys } from "../../ssh/index.js";

export const deploymentCreateValidation: FastifySchemaCompiler<FastifySchema> =
  ({ httpPart }) => {
    if (httpPart !== "body") return undefined as never;

    return (data: unknown) => {
      const body = data as DeploymentCreateBody;
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
      const result = validateJobDefinition(body.job_definition);

      if (!result.success) {
        const message = result.errors
          .map(
            (e: { path: string; expected: string }) =>
              `job_definition${e.path}: ${e.expected}`
          )
          .join(", ");
        return { error: new Error(message) };
      }

      const sshError = validateJobDefinitionSshKeys(body.job_definition as JobDefinition);
      if (sshError) {
        return { error: new Error(`job_definition.ssh.public_keys: ${sshError}`) };
      }

      return { value: data };
    };
  };
