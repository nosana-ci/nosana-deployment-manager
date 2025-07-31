import { FastifySchema } from "fastify";
import { Type, Static } from "@sinclair/typebox";
import { ErrorSchema } from "../../../index.schema";

const VaultWithdrawBody = Type.Object({
  SOL: Type.Optional(Type.Number({ minimum: 0 })),
  NOS: Type.Optional(Type.Number({ minimum: 0 })),
});
export type VaultWithdrawBody = Static<typeof VaultWithdrawBody>;

const VaultWithdrawSuccess = Type.Object({
  transaction: Type.String(),
});
export type VaultWithdrawSuccess = Static<typeof VaultWithdrawSuccess>;
export type VaultWithdrawError = ErrorSchema;

export const VaultWithdrawSchema: FastifySchema = {
  description: "Withdraw from a vault.",
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
  body: VaultWithdrawBody,
  response: {
    200: {
      description: "Withdrawal successful.",
      content: {
        "application/json": {
          schema: VaultWithdrawSuccess,
        },
      },
    },
    400: {
      description: "Invalid request body.",
      content: {
        "application/json": {
          schema: {
            $ref: "Error",
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
