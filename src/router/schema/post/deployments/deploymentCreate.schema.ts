import { FastifySchema } from "fastify";
import { Type, Static } from "@sinclair/typebox";

import type { DeploymentSchema, ErrorSchema } from "../../index.schema";

import { DeploymentStrategy } from "../../../../types/index.js";

const DeploymentCreateBody = Type.Intersect([
  Type.Object({
    name: Type.String(),
    market: Type.String(),
    ipfs_definition_hash: Type.String(),
    replicas: Type.Number({ minimum: 1 }),
    timeout: Type.Number({ minimum: 60 }),
  }),
  Type.Union([
    Type.Object({
      strategy: Type.Union(
        Object.values(DeploymentStrategy)
          .filter((strategy) => strategy !== "SCHEDULED")
          .map((strategy) => Type.Literal(strategy))
      ),
    }),
    Type.Object({
      strategy: Type.Literal("SCHEDULED"),
      schedule: Type.String(),
    }),
  ]),
]);

export type DeploymentCreateBody = Static<typeof DeploymentCreateBody> & {
  schedule?: string; // Optional for non-scheduled strategies
};

export type DeploymentCreateSuccess = DeploymentSchema;
export type DeploymentCreateError = ErrorSchema;

export const DeploymentCreateSchema: FastifySchema = {
  description: "Create a new deployment.",
  tags: ["Deployments"],
  headers: {
    $ref: "Headers",
  },
  body: DeploymentCreateBody,
  response: {
    201: {
      description: "Deployment created successfully.",
      content: {
        "application/json": {
          schema: {
            $ref: "Deployment",
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
