import { validateJobDefinition, JobDefinition } from "@nosana/kit";
import { FastifySchemaCompiler } from "fastify/types/schema.js";
import { FastifySchema } from "fastify";

import { validateJobDefinitionSshKeys } from "../../ssh/index.js";

/**
 * Why the Nosana Kit's validator rejects a job definition, one entry per problem, with
 * paths written from `field` (the Kit's own paths start at `$input`); empty when valid.
 */
export function jobDefinitionErrors(jobDefinition: unknown, field = "job_definition"): string[] {
  const result = validateJobDefinition(jobDefinition as JobDefinition);
  if (!result.success) {
    return result.errors.map(
      (e: { path: string; expected: string }) => `${e.path.replace(/^\$input/, field)}: expected ${e.expected}`
    );
  }

  const sshError = validateJobDefinitionSshKeys(jobDefinition as JobDefinition);
  if (sshError) return [`${field}.ssh.public_keys: ${sshError}`];

  return [];
}

export const jobDefinitionValidation: FastifySchemaCompiler<FastifySchema> = ({
  httpPart,
}) => {
  if (httpPart !== "body") return undefined as never;

  return (data: unknown) => {
    const errors = jobDefinitionErrors(data);
    return errors.length ? { error: new Error(errors.join(", ")) } : { value: data };
  };
};
