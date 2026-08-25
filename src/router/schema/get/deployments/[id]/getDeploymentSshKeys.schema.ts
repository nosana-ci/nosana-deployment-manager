import { FastifySchema } from "fastify";
import { Static, Type } from "@sinclair/typebox";

import { ErrorSchema } from "../../../index.schema.js";

const GetDeploymentSshKeysSuccess = Type.Object({
  public_keys: Type.Array(Type.String()),
});

export type GetDeploymentSshKeysSuccess = Static<typeof GetDeploymentSshKeysSuccess>;
export type GetDeploymentSshKeysError = ErrorSchema;

export const GetDeploymentSshKeysSchema: FastifySchema = {
  description: "Get the SSH public keys currently granted access to the deployment's jobs.",
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
      description: "The deployment's SSH public keys (empty when SSH access is not configured).",
      content: {
        "application/json": {
          schema: GetDeploymentSshKeysSuccess,
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
