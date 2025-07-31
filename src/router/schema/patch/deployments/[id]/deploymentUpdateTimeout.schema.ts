import { FastifySchema } from "fastify";
import { Static, Type } from "@sinclair/typebox";
import { ErrorSchema } from "../../../index.schema";

const DeploymentUpdateTimeoutSuccess = Type.Object({
  timeout: Type.Number(),
  updated_at: Type.String(),
});

export type DeploymentUpdateTimeoutSuccess = Static<
  typeof DeploymentUpdateTimeoutSuccess
>;
export type DeploymentUpdateTimeoutError = ErrorSchema;

export const DeploymentUpdateTimeoutSchema: FastifySchema = {
  description: "Update deployment timeout",
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
  body: Type.Object({
    timeout: Type.Number({ minimum: 60 }),
  }),
  response: {
    200: {
      description: "Deployment timeout updated successfully.",
      content: {
        "application/json": {
          schema: DeploymentUpdateTimeoutSuccess,
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
