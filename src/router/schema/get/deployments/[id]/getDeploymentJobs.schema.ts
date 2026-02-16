import { FastifySchema } from "fastify";
import { Type } from "@sinclair/typebox";

import { ErrorSchema } from "../../../index.schema.js";

export type GetDeploymentJobsSuccess = Array<unknown>;
export type GetDeploymentJobsError = ErrorSchema;

export const GetDeploymentJobsSchema: FastifySchema = {
  description: "Get jobs for a specific deployment.",
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
      description: "List of jobs for the deployment.",
      content: {
        "application/json": {
          schema: {
            type: "array",
            items: {
              $ref: "Job",
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
