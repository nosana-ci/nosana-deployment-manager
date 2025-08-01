import { FastifySchema } from "fastify";
import { Static, Type } from "@sinclair/typebox";

import { ErrorSchema } from "../../../index.schema";

const VaultUpdateBalanceSuccess = Type.Object({
  SOL: Type.Number(),
  NOS: Type.Number(),
});

export type VaultUpdateBalanceSuccess = Static<
  typeof VaultUpdateBalanceSuccess
>;
export type VaultUpdateBalanceError = ErrorSchema;

export const VaultUpdateBalanceSchema: FastifySchema = {
  description: "Update the balance of a vault.",
  tags: ["Vaults"],
  headers: {
    $ref: "Headers",
  },
  params: {
    type: "object",
    properties: {
      vault: {
        $ref: "PublicKey",
      },
    },
    required: ["vault"],
  },
  response: {
    200: {
      description: "Balance updated successfully.",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              SOL: { type: "number" },
              NOS: { type: "number" },
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
      description: "Vault not found.",
      content: {
        "application/json": {
          schema: {
            $ref: "Error",
          },
        },
      },
    },
    500: {
      description: "Internal server error.",
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
