import { FastifySchema } from "fastify";
import { Type } from "@sinclair/typebox";

import type { ErrorSchema, VaultsSchema } from "../../index.schema.js";

export type VaultsHandlerSuccess = VaultsSchema;
export type VaultsHandlerError = ErrorSchema;

export const VaultsHandlerSchema: FastifySchema = {
  description: "List all user vaults.",
  tags: ["Vaults"],
  headers: {
    $ref: "Headers",
  },
  response: {
    200: {
      description: "List of vaults.",
      content: {
        "application/json": {
          schema: {
            $ref: "Vaults",
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
  security: [
    {
      Authorization: [],
    },
  ],
};
