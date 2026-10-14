import { FastifySchema } from "fastify";
import { Type, Static } from "@sinclair/typebox";

export const DeploymentValidateResponseSchema = Type.Object({
  valid: Type.Boolean(),
  errors: Type.Array(Type.String(), {
    description: "Why a create with this body would be rejected, one entry per problem; empty when valid.",
  }),
});
export type DeploymentValidateResponse = Static<typeof DeploymentValidateResponseSchema>;

export const DeploymentValidateSchema: FastifySchema & { "x-mcp-read-only": boolean } = {
  description:
    "Check a deployment before creating it: takes the same body as /deployments/create, runs the " +
    "same validation (including the job definition, with the Nosana Kit's validator) and reports every " +
    "problem without creating anything. Fix what it reports and validate again before creating.",
  tags: ["Deployments", "mcp"],
  // Creates nothing, so MCP clients may run it without asking the user.
  "x-mcp-read-only": true,
  headers: {
    $ref: "Headers",
  },
  body: {
    $ref: "DeploymentCreateBody",
  },
  response: {
    200: {
      description: "Whether the body would be accepted, and why not.",
      content: { "application/json": { schema: DeploymentValidateResponseSchema } },
    },
  },
};
