import { FastifySchema } from "fastify";
import { Type } from "@sinclair/typebox";

import { ErrorSchema } from "../../../index.schema.js";

export type GetDeploymentRevisionsSuccess = Array<unknown>;
export type GetDeploymentRevisionsError = ErrorSchema;

export const GetDeploymentRevisionsSchema: FastifySchema = {
  description: "Get revisions for a specific deployment.",
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
      description: "List of revisions for the deployment.",
      content: {
        "application/json": {
          schema: {
            type: "array",
            items: {
              $ref: "Revision",
            },
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
