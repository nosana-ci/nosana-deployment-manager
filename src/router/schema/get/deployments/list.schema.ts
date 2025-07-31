import { FastifySchema } from "fastify";
import { Type } from "@sinclair/typebox";

import type { DeploymentsSchema, ErrorSchema } from "../../index.schema.js";

export type DeploymentsHandlerSuccess = DeploymentsSchema;
export type DeploymentsHandlerError = ErrorSchema;

export const DeploymentsHandlerSchema: FastifySchema = {
  description: "List all user deployments.",
  tags: ["Deployments"],
  headers: {
    $ref: "Headers",
  },
  response: {
    200: {
      description: "List of deployments.",
      content: {
        "application/json": {
          schema: {
            $ref: "Deployments",
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
