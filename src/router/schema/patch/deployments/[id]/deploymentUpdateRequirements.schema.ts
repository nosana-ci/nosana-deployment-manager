import { FastifySchema } from "fastify";
import { Static, Type } from "@sinclair/typebox";

import type { ErrorSchema } from "../../../index.schema.js";
import { PublicKeySchema } from "../../../components/publicKey.schema.js";
import { RequirementsSchema } from "../../../components/requirements.schema.js";

const DeploymentUpdateRequirementsSuccess = Type.Object({
  requirements: Type.Union([RequirementsSchema, Type.Null()]),
  market: Type.Union([PublicKeySchema, Type.Null()]),
  updated_at: Type.String({ format: "date-time" }),
});

export type DeploymentUpdateRequirementsSuccess = Static<typeof DeploymentUpdateRequirementsSuccess>;
export type DeploymentUpdateRequirementsError = ErrorSchema;

export const DeploymentUpdateRequirementsSchema: FastifySchema = {
  description:
    "Replace the node requirements of a deployment, or clear them with null, together with the market that serves them, as on create. Every job listed from now on is reserved on nodes that meet the new requirements. Omit the market (or send null) to post across markets: each job goes to the cheapest PREMIUM market with a node that meets them. Running jobs keep their hosts, unless the market changes to another one: then a RUNNING deployment's jobs are stopped and relisted on it, as with update-market.",
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
    requirements: Type.Union([RequirementsSchema, Type.Null()]),
    market: Type.Optional(Type.Union([PublicKeySchema, Type.Null()])),
  }),
  response: {
    200: {
      description: "Deployment requirements updated successfully.",
      content: {
        "application/json": {
          schema: DeploymentUpdateRequirementsSuccess,
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
