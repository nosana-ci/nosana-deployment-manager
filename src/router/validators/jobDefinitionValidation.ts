import { validateJobDefinition, JobDefinition } from "@nosana/kit";
import { FastifySchemaCompiler } from "fastify/types/schema.js";

export const jobDefinitionValidation: FastifySchemaCompiler<JobDefinition> = () => {
  return (data: JobDefinition) => {
    const result = validateJobDefinition(data);

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
