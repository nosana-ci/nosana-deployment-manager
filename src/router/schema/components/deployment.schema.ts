import { Static, Type } from "@sinclair/typebox";

import { PublicKeySchema } from "./publicKey.schema.js";
import { EndpointSchema } from "./endpoint.schema.js";

import { DeploymentStatus, DeploymentStrategy } from "../../../types/index.js";

export const DeploymentStatusSchema = Type.Union(
  Object.values(DeploymentStatus).map((val) => Type.Literal(val))
);

export type DeploymentStatusSchema = Static<typeof DeploymentStatusSchema>;

export const DeploymentStrategySchema = Type.Union(
  Object.values(DeploymentStrategy).map((val) => Type.Literal(val))
);

export type DeploymentStrategySchema = Static<typeof DeploymentStrategySchema>;

export const DeploymentSchema = Type.Intersect([
  Type.Object({
    id: Type.String(),
    name: Type.String(),
    vault: PublicKeySchema,
    market: PublicKeySchema,
    owner: PublicKeySchema,
    status: DeploymentStatusSchema,
    replicas: Type.Number({ minimum: 1 }),
    timeout: Type.Number({ minimum: 1 }),
    endpoints: Type.Array(EndpointSchema),
    confidential: Type.Boolean(),
    active_revision: Type.Number({ minimum: 1 }),
    active_jobs: Type.Number({ minimum: 0 }),
    created_at: Type.String({ format: "date-time" }),
    updated_at: Type.String({ format: "date-time" }),
  }),
  Type.Union([
    Type.Object({
      strategy: Type.Union(
        Object.values(DeploymentStrategy)
          .filter((strategy) => !([DeploymentStrategy.SCHEDULED, DeploymentStrategy.INFINITE] as DeploymentStrategy[]).includes(strategy))
          .map((val) => Type.Literal(val))
      ),
    }),
    Type.Object({
      strategy: Type.Literal(DeploymentStrategy.SCHEDULED),
      schedule: Type.String({
        description: "Cron expression for scheduled deployments",
        pattern: "^\\s*(\\S+)\\s+(\\S+)\\s+(\\S+)\\s+(\\S+)\\s+(\\S+)\\s*$",
      }),
    }),
    Type.Object({
      timeout: Type.Number({ minimum: 60 }),
      strategy: Type.Literal(DeploymentStrategy.INFINITE),
      rotation_time: Type.Number()
    }),
  ]),
]);
export type DeploymentSchema = Static<typeof DeploymentSchema>;

export const DeploymentsSchema = Type.Array(DeploymentSchema);
export type DeploymentsSchema = Static<typeof DeploymentsSchema>;
