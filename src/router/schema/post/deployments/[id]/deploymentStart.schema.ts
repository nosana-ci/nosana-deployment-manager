import { Static, Type } from "@sinclair/typebox";
import { FastifySchema } from "fastify";

import { DeploymentStatus } from "../../../../../types/index.js";
import { ErrorSchema } from "../../../index.schema.js";

export const DeploymentStartSuccess = Type.Object({
  status: Type.Literal(DeploymentStatus.STARTING),
});

export type DeploymentStartSuccess = Static<typeof DeploymentStartSuccess>;
export type DeploymentStartError = ErrorSchema;

export const DeploymentStartSchema: FastifySchema = {
  description: "Start an existing deployment.",
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
      description: "Deployment started successfully.",
      content: {
        "application/json": {
          schema: DeploymentStartSuccess,
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
};
