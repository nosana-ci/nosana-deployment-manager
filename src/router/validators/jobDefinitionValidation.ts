import { validateJobDefinition, JobDefinition } from "@nosana/kit";
import { FastifySchemaCompiler } from "fastify/types/schema.js";
import { FastifySchema } from "fastify";

import { validateJobDefinitionSshKeys } from "../../ssh/index.js";

export const jobDefinitionValidation: FastifySchemaCompiler<FastifySchema> = ({
  httpPart,
}) => {
  if (httpPart !== "body") return undefined as never;

  return (data: unknown) => {
    const result = validateJobDefinition(data as JobDefinition);

    if (!result.success) {
      const message = result.errors
        .map(
          (e: { path: string; expected: string }) => `${e.path}: ${e.expected}`
        )
        .join(", ");
      return { error: new Error(message) };
    }

    const sshError = validateJobDefinitionSshKeys(data as JobDefinition);
    if (sshError) {
      return { error: new Error(`ssh.public_keys: ${sshError}`) };
    }

    return { value: data };
  };
};
