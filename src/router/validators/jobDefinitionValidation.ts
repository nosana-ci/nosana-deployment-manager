import { validateJobDefinition, JobDefinition } from "@nosana/kit";
import { FastifySchemaCompiler } from "fastify/types/schema.js";
import { FastifySchema } from "fastify";

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
    return { value: data };
  };
};
