import { FastifySchema } from "fastify";
import { Type, Static } from "@sinclair/typebox";

export const DeploymentValidateResponseSchema = Type.Object({
  valid: Type.Boolean(),
  errors: Type.Array(Type.String(), {
    description: "Why the job definition would be rejected, one entry per problem; empty when valid.",
  }),
});
export type DeploymentValidateResponse = Static<typeof DeploymentValidateResponseSchema>;

export const DeploymentValidateSchema: FastifySchema & { "x-mcp-read-only": boolean } = {
  description:
    "Check a job definition before creating a deployment with it: runs the Nosana Kit's validator, the " +
    "same check /deployments/create applies to job_definition, and reports every problem without " +
    "creating anything. Fix what it reports and validate again before creating.",
  tags: ["Deployments", "mcp"],
  // Creates nothing, so MCP clients may run it without asking the user.
  "x-mcp-read-only": true,
  headers: {
    $ref: "Headers",
  },
  body: Type.Object({ job_definition: Type.Ref("JobDefinition") }),
  response: {
    200: {
      description: "Whether the job definition would be accepted, and why not.",
      content: { "application/json": { schema: DeploymentValidateResponseSchema } },
    },
  },
};
