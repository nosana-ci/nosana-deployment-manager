import { FastifySchema } from "fastify";

import type { DeploymentSchema, ErrorSchema } from "../../../index.schema.js";

export type DeploymentByIdSuccess = DeploymentSchema;
export type DeploymentByIdError = ErrorSchema;

export const DeploymentByIdSchema: FastifySchema = {
  description: "Get a specific deployment by ID.",
  tags: ["Deployments"],
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
      description: "Gets a deployment by ID.",
      content: {
        "application/json": {
          schema: {
            $ref: "Deployment",
          },
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
};
