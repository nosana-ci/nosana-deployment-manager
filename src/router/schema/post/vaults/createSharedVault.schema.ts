import { FastifySchema } from "fastify";
import { Type, Static } from "@sinclair/typebox";
import { ErrorSchema } from "../../index.schema.js";

const CreateSharedVaultSuccess = Type.Object({
  vault: Type.String(),
  owner: Type.String(),
  created_at: Type.String({ format: "date-time" }),
});
export type CreateSharedVaultSuccess = Static<typeof CreateSharedVaultSuccess>;

export type CreateSharedVaultError = ErrorSchema;

export const CreateSharedVaultSchema: FastifySchema = {
  description: "Create a shared vault.",
  tags: ["Deployments Vaults"],
  headers: {
    $ref: "Headers",
  },
  response: {
    200: {
      description: "Vault created successfully.",
      content: {
        "application/json": {
          schema: {
            $ref: "Vault"
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
