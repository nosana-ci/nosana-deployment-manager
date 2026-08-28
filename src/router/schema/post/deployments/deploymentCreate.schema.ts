import { FastifySchema } from "fastify";
import { CloneType, Type, Static } from "@sinclair/typebox";

import { PublicKeySchema, type DeploymentSchema, type ErrorSchema } from "../../index.schema.js";

import { DeploymentStrategy } from "../../../../types/index.js";
import { DeploymentScheduleSchema } from "../../components/deploymentSchedule.schema.js";
import { SshPublicKeysSchema } from "../../components/ssh.schema.js";

export const DeploymentCreateBodySchema = Type.Intersect([
  Type.Object({
    name: Type.String(),
    market: Type.String(),
    replicas: Type.Number({ minimum: 1 }),
    timeout: Type.Number({ minimum: 1, description: "Timeout in minutes, must be at least 1 minute." }),
    confidential: Type.Optional(Type.Boolean()),
    autostart: Type.Optional(Type.Boolean({
      description: "If true, the deployment is started immediately after creation instead of being left as a DRAFT.",
    })),
    ssh_public_keys: Type.Optional(
      CloneType(SshPublicKeysSchema, {
        description:
          "SSH public keys granted access to this deployment's jobs. Takes precedence over an `ssh` block inside job_definition.",
      })
    ),
    job_definition: Type.Ref("JobDefinition")
  }),
  // A deployment funds from exactly one vault source: the owner's shared
  // (oldest) vault by default, an existing owned vault, or a newly created
  // dedicated vault. `vault` and `new_vault` are mutually exclusive — the
  // Type.Never cross-fields make a body containing both fail validation.
  Type.Union([
    Type.Object({
      vault: Type.Optional(PublicKeySchema),
      new_vault: Type.Optional(Type.Never()),
    }),
    Type.Object({
      new_vault: Type.Optional(Type.Boolean({
        description: "If true, a brand-new vault is created for this deployment instead of reusing the owner's shared (oldest) vault.",
      })),
      vault: Type.Optional(Type.Never()),
    }),
  ]),
  Type.Union([
    Type.Object({
      strategy: Type.Union(
        Object.values(DeploymentStrategy)
          .filter((strategy) => !([DeploymentStrategy.SCHEDULED, DeploymentStrategy.INFINITE] as DeploymentStrategy[]).includes(strategy))
          .map((strategy) => Type.Literal(strategy))
      ),
    }),
    Type.Object({
      strategy: Type.Literal(DeploymentStrategy.SCHEDULED),
      schedule: DeploymentScheduleSchema,
    }),
    Type.Object({
      timeout: Type.Number({ minimum: 60, description: "Timeout in minutes, must be at least 60 minute." }),
      strategy: Type.Literal(DeploymentStrategy.INFINITE),
      rotation_time: Type.Optional(Type.Number({
        description: "Rotation time in seconds. Must be at least 10 minutes less than timeout to allow for proper rotation."
      })),
      startup_timeout: Type.Optional(Type.Number({
        minimum: 1,
        description:
          "Minutes a job has, from the moment a node starts running it, to open its network tunnel. A job that does not come online in time is stopped and replaced on another node. Must cover the image pull and any operations that run before the exposed one. Requires the job definition to expose at least one port.",
      })),
    })
  ]),
]);

export const DeploymentMetadataSchema = Type.Omit(DeploymentCreateBodySchema, [
  "job_definition",
]);

export type DeploymentCreateBody = Static<typeof DeploymentCreateBodySchema> & {
  schedule?: string; // Optional for non-scheduled strategies
  rotation_time?: number; // Optional for non-infinite strategies
  startup_timeout?: number; // Optional, infinite strategy only
  vault?: string; // Only for the existing-vault variant
  new_vault?: boolean; // Only for the new-vault variant
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
