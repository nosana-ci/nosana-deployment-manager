import { FastifySchema } from "fastify";
import { Static, Type } from "@sinclair/typebox";

import type { ErrorSchema } from "../../../index.schema.js";
import { PublicKeySchema } from "../../../components/publicKey.schema.js";

const DeploymentUpdateMarketSuccess = Type.Object({
  market: PublicKeySchema,
  updated_at: Type.String({ format: "date-time" }),
});

export type DeploymentUpdateMarketSuccess = Static<typeof DeploymentUpdateMarketSuccess>;
export type DeploymentUpdateMarketError = ErrorSchema;

export const DeploymentUpdateMarketSchema: FastifySchema = {
  description:
    "Update the market of a deployment. A RUNNING deployment's current jobs are stopped and relisted on the new market: SIMPLE and SIMPLE-EXTEND relist the stopped count immediately, INFINITE refills each stopped replica, and SCHEDULED lists on its next scheduled run.",
  tags: ["Deployments", "mcp"],
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
  body: Type.Object({
    market: PublicKeySchema,
  }),
  response: {
    200: {
      description: "Deployment market updated successfully.",
      content: {
        "application/json": {
          schema: DeploymentUpdateMarketSuccess,
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
