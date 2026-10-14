import { FastifySchemaCompiler } from "fastify/types/schema.js";
import { Value } from "@sinclair/typebox/value";
import {
  DeploymentCreateBody,
  DeploymentMetadataSchema,
} from "../schema/post/deployments/deploymentCreate.schema.js";
import { FastifySchema } from "fastify";

import { validateSshPublicKeys } from "../../ssh/index.js";
import { jobDefinitionErrors } from "./jobDefinitionValidation.js";

/**
 * Why a create body would be rejected, one entry per problem; empty when it is valid.
 * Checks run in order (the body's shape, its fields, the job definition with the Kit's
 * validator, then SSH keys) and stop at the first group that fails.
 */
function deploymentCreateErrors(data: unknown): string[] {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return ["The request body must be a JSON object, not a string or a list."];
  }
  const body = data as DeploymentCreateBody;

  // The metadata-only schema leaves job_definition to the Kit's validator below.
  const metadataErrors = [...Value.Errors(DeploymentMetadataSchema, data)];
  if (metadataErrors.length > 0) {
    return metadataErrors.map((e) => `${e.path.replace(/^\//, "")}: ${e.message}`);
  }

  const jobErrors = jobDefinitionErrors(body.job_definition);
  if (jobErrors.length) return jobErrors;

  if (body.ssh_public_keys) {
    const topLevelSshError = validateSshPublicKeys(body.ssh_public_keys.map((key) => key.trim()));
    if (topLevelSshError) return [`ssh_public_keys: ${topLevelSshError}`];
  }

  return [];
}

export const deploymentCreateValidation: FastifySchemaCompiler<FastifySchema> =
  ({ httpPart }) => {
    if (httpPart !== "body") return undefined as never;

    return (data: unknown) => {
      const errors = deploymentCreateErrors(data);
      return errors.length ? { error: new Error(errors.join(", ")) } : { value: data };
    };
  };
