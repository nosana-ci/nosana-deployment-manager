import { FastifySchema } from "fastify";
import { Type, Static } from "@sinclair/typebox";

import { PublicKeySchema, type DeploymentSchema, type ErrorSchema } from "../../index.schema.js";

import { DeploymentStrategy } from "../../../../types/index.js";
import { JobDefinitionSchema } from "../../components/jobDefinition.schema.js";

export const DeploymentScheduleSchema = Type.String({
  description: "Cron expression for scheduled deployments",
  pattern: "^\\s*(\\S+)\\s+(\\S+)\\s+(\\S+)\\s+(\\S+)\\s+(\\S+)\\s*$",
})

export const DeploymentCreateBodySchema = Type.Intersect([
  Type.Object({
    name: Type.String(),
    market: Type.String(),
    replicas: Type.Number({ minimum: 1 }),
    timeout: Type.Number({ minimum: 60 }),
    vault: Type.Optional(PublicKeySchema),
    confidential: Type.Optional(Type.Boolean()),
    job_definition: JobDefinitionSchema
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
      schedule: DeploymentScheduleSchema,
    }),
  ]),
]);

export type DeploymentCreateBody = Static<typeof DeploymentCreateBodySchema> & {
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
  body: {
    $ref: "DeploymentCreateBody",
  },
  response: {
    200: {
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
  security: [
    {
      Authorization: [],
    },
  ],
};
