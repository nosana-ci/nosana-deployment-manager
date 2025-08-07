import { Static, Type } from "@sinclair/typebox";

import { JobsSchema } from "./job.schema.js";
import { EventsSchema } from "./event.schema.js";
import { PublicKeySchema } from "./publicKey.schema.js";

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
    ipfs_definition_hash: Type.String(),
    replicas: Type.Number({ minimum: 1 }),
    timeout: Type.Number({ minimum: 60 }),
    jobs: Type.Array(JobsSchema),
    events: Type.Array(EventsSchema),
    created_at: Type.String({ format: "date-time" }),
    updated_at: Type.String({ format: "date-time" }),
  }),
  Type.Union([
    Type.Object({
      strategy: Type.Union(
        Object.values(DeploymentStrategy)
          .filter((val) => val !== DeploymentStrategy.SCHEDULED)
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
  ]),
]);
export type DeploymentSchema = Static<typeof DeploymentSchema>;

export const DeploymentsSchema = Type.Array(DeploymentSchema);
export type DeploymentsSchema = Static<typeof DeploymentsSchema>;
