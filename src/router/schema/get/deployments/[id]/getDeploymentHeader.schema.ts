import { FastifySchema } from "fastify";
import { Type } from "@sinclair/typebox";

import { ErrorSchema } from "../../../index.schema";

export type GetDeploymentHeaderSuccess = { header: string };
export type GetDeploymentHeaderError = ErrorSchema;

export const GetDeploymentHeaderSchema: FastifySchema = {
  description: "Get header for a specific deployment.",
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
      type: "string",
      description: "Returns authorization header to interact with the vaults jobs.",
      content: {
        "application/json": {
          schema: Type.Object({ header: Type.String() }),
        },
      }
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
