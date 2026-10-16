import { FastifySchema } from "fastify";
import { Type } from "@sinclair/typebox";

import { ErrorSchema } from "../../../index.schema";

export type GetDeploymentJobHeadersSuccess = { headers: Record<string, string> };
export type GetDeploymentJobHeadersError = ErrorSchema;

export const GetDeploymentJobHeadersSchema: FastifySchema = {
  description: "Get a timestamped authorization header for each of the deployment's running jobs.",
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
      description: "One header per running job, keyed by job address.",
      content: {
        "application/json": {
          schema: Type.Object({
            headers: Type.Record(Type.String(), Type.String()),
          }),
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
