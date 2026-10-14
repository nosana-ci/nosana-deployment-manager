import { validateJobDefinition, type JobDefinition } from "@nosana/kit";
import { FastifySchemaCompiler } from "fastify/types/schema.js";
import { Value } from "@sinclair/typebox/value";
import {
  DeploymentCreateBody,
  DeploymentMetadataSchema,
} from "../schema/post/deployments/deploymentCreate.schema.js";
import { FastifySchema } from "fastify";

import { validateJobDefinitionSshKeys, validateSshPublicKeys } from "../../ssh/index.js";

type SchemaError = { path: string; message: string; errors?: Iterable<SchemaError>[] };

/**
 * A TypeBox error as messages a reader can act on. A union reports only "Expected union
 * value" at its own path; its branches' errors are nested, so the branch that came
 * closest to matching speaks for it, and a choice between literals lists them.
 */
function describeSchemaError(error: SchemaError): string[] {
  const field = error.path.replace(/^\//, "").replace(/\//g, ".") || "body";
  const branches = (error.errors ?? []).map((branch) => [...branch]);
  // A union branch forbids a field with Never: it cannot be combined with the others given.
  if (error.message === "Never") return [`${field}: not allowed together with the other fields given`];
  if (branches.length === 0) return [`${field}: ${error.message}`];
  if (branches.every((branch) => branch.length === 1 && branch[0]!.message.startsWith("Expected '"))) {
    const values = branches.map((branch) => branch[0]!.message.slice("Expected ".length));
    return [`${field}: Expected one of ${values.join(", ")}`];
  }
  const closest = branches.reduce((best, branch) => (branch.length < best.length ? branch : best));
  return closest.flatMap(describeSchemaError);
}

/**
 * Why a create body would be rejected, one entry per problem; empty when it is valid.
 * Checks run in order (the body's shape, its fields, the job definition with the Kit's
 * validator, then SSH keys) and stop at the first group that fails.
 */
export function deploymentCreateErrors(data: unknown): string[] {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return ["The request body must be a JSON object, not a string or a list."];
  }
  const body = data as DeploymentCreateBody;

  // The metadata-only schema leaves job_definition to the Kit's validator below.
  const metadataErrors = [...Value.Errors(DeploymentMetadataSchema, data)];
  if (metadataErrors.length > 0) {
    // An intersection also reports "Expected all values to match" beside its parts' own errors.
    const messages = metadataErrors
      .filter((e) => metadataErrors.length === 1 || e.message !== "Expected all values to match")
      .flatMap((e) => describeSchemaError(e as SchemaError));
    return [...new Set(messages)];
  }

  const result = validateJobDefinition(body.job_definition);
  if (!result.success) {
    return result.errors.map(
      (e: { path: string; expected: string }) => `job_definition${e.path}: ${e.expected}`
    );
  }

  const sshError = validateJobDefinitionSshKeys(body.job_definition as JobDefinition);
  if (sshError) return [`job_definition.ssh.public_keys: ${sshError}`];

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
