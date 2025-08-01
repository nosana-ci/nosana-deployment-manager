import { FastifySchema } from "fastify";
import { Type, Static } from "@sinclair/typebox";

import { ErrorSchema } from "../../../index.schema.js";
import { DeploymentStatus } from "../../../../../types/index.js";

const DeploymentStopSuccess = Type.Object({
  status: Type.Literal(DeploymentStatus.STOPPING),
  updated_at: Type.String({ format: "date-time" }),
});

export type DeploymentStopSuccess = Static<typeof DeploymentStopSuccess>;
export type DeploymentStopError = ErrorSchema;

export const DeploymentStopSchema: FastifySchema = {
  description: "Stop a deployment",
  tags: ["deployments"],
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
      description: "Deployment stopped successfully.",
      content: {
        "application/json": {
          schema: DeploymentStopSuccess,
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
