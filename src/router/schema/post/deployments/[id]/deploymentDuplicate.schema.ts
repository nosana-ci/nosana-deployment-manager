import { Static, Type } from "@sinclair/typebox";
import { FastifySchema } from "fastify";

import type { DeploymentSchema, ErrorSchema } from "../../../index.schema.js";

export const DeploymentDuplicateBodySchema = Type.Object({
  name: Type.Optional(Type.String({
    minLength: 1,
    description: "Name for the new deployment. Defaults to \"<source name> (copy)\".",
  })),
  autostart: Type.Optional(Type.Boolean({
    description: "If true, the new deployment is started immediately after creation instead of being left as a DRAFT.",
  })),
});

export type DeploymentDuplicateBody = Static<typeof DeploymentDuplicateBodySchema>;
export type DeploymentDuplicateSuccess = DeploymentSchema;
export type DeploymentDuplicateError = ErrorSchema;

export const DeploymentDuplicateSchema: FastifySchema = {
  description:
    "Duplicate a deployment. Creates a new DRAFT deployment named `name` (defaulting to \"<source name> (copy)\"), or starts it right away with `autostart`, with the same vault, market, replicas, timeout, strategy, confidentiality and SSH keys, and the source's active revision as its first revision. The source is left untouched. The body may be omitted.",
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
  body: DeploymentDuplicateBodySchema,
  response: {
    200: {
      description: "Deployment duplicated successfully.",
      content: {
        "application/json": {
          schema: {
            $ref: "Deployment",
          },
        },
      },
    },
    401: {
      description: "Unauthorized. Invalid or missing authentication.",
      content: {
        "application/json": {
          schema: Type.Literal("Unauthorized"),
        },
      },
    },
    404: {
      description: "Deployment not found.",
      content: {
        "application/json": {
          schema: {
            $ref: "Error",
          },
        },
      },
    },
    500: {
      description: "Internal Server Error.",
      content: {
        "application/json": {
          schema: {
            $ref: "Error",
          },
        },
      },
    },
  },
  security: [
    {
      Authorization: [],
    },
  ],
};
