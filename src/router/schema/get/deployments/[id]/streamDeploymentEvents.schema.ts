import { FastifySchema } from "fastify";

/**
 * The frames are described for the OpenAPI document, from which the clients
 * generate their types. Nothing serializes them: the handler hijacks the reply
 * and writes each frame to the raw socket itself.
 */
export const StreamDeploymentEventsSchema: FastifySchema = {
  description:
    "Server-sent stream of a deployment's changes. Each message is one " +
    "`DeploymentStreamEvent`, discriminated by `type`. The stream starts with " +
    "the current deployment, its active jobs and its outstanding tasks, then " +
    "emits live changes. Historical jobs and events remain available through " +
    "their paginated endpoints.",
  tags: ["Deployments", "mcp"],
  headers: {
    $ref: "Headers",
  },
  params: {
    type: "object",
    properties: {
      deployment: {
        $ref: "PublicKey",
      },
    },
    required: ["deployment"],
  },
  response: {
    200: {
      content: {
        "text/event-stream": {
          schema: {
            $ref: "DeploymentStreamEvent",
          },
        },
      },
    },
  },
};
