import { FastifyInstance } from "fastify";

import {
  DeploymentSchema,
  DeploymentStatusSchema,
  DeploymentStrategySchema,
} from "./components/deployment.schema.js";
import { JobSchema } from "./components/job.schema.js";
import { TaskSchema } from "./components/task.schema.js";
import { ErrorSchema } from "./components/error.schema.js";
import { EventSchema } from "./components/event.schema.js";
import { HeadersSchema, HostHeadersSchema } from "./components/headers.schema.js";
import { EndpointSchema } from "./components/endpoint.schema.js";
import { RevisionSchema } from "./components/revision.schema.js";
import { PublicKeySchema } from "./components/publicKey.schema.js";
import { JobResultsSchema } from "./components/jobResults.schema.js";
import { VaultSchema, VaultsSchema } from "./components/vault.schema.js";
import { JobDefinitionSchema } from "./components/jobDefinition.schema.js";

export * from "./components/deployment.schema.js";
export * from "./components/error.schema.js";
export * from "./components/event.schema.js";
export * from "./components/headers.schema.js";
export * from "./components/job.schema.js";
export * from "./components/jobResults.schema.js";
export * from "./components/jobDefinition.schema.js";
export * from "./components/publicKey.schema.js";
export * from "./components/task.schema.js";
export * from "./components/vault.schema.js";

import * as getSchemas from "./get/index.schema.js";
import * as postSchemas from "./post/index.schema.js";
import * as patchSchemas from "./patch/index.schema.js";
import * as deleteSchemas from "./delete/index.schema.js";

export const routeSchemas = {
  get: getSchemas,
  post: postSchemas,
  patch: patchSchemas,
  delete: deleteSchemas,
};

export function addSchemas(server: FastifyInstance) {
  server.addSchema({
    $id: "Headers",
    ...HeadersSchema,
  });

  server.addSchema({
    $id: "HostHeaders",
    ...HostHeadersSchema
  })

  server.addSchema({
    $id: "Deployment",
    ...DeploymentSchema,
  });

  server.addSchema({
    $id: "Deployments",
    type: "array",
    items: {
      $ref: "Deployment",
    },
  });

  server.addSchema({
    $id: "DeploymentStatus",
    ...DeploymentStatusSchema,
  });

  server.addSchema({
    $id: "DeploymentStrategy",
    ...DeploymentStrategySchema,
  });

  server.addSchema({
    $id: "DeploymentCreateBody",
    ...postSchemas.DeploymentCreateBodySchema,
  });

  server.addSchema({
    $id: "Endpoint",
    ...EndpointSchema,
  });

  server.addSchema({
    $id: "Error",
    ...ErrorSchema,
  });

  server.addSchema({
    $id: "Event",
    ...EventSchema,
  });

  server.addSchema({
    $id: "Job",
    ...JobSchema,
  });

  server.addSchema({
    $id: "PublicKey",
    ...PublicKeySchema,
  });

  server.addSchema({
    $id: "Task",
    ...TaskSchema,
  });

  server.addSchema({
    $id: "Vault",
    ...VaultSchema
  });

  server.addSchema({
    $id: "Vaults",
    ...VaultsSchema
  });

  server.addSchema({
    $id: "Revision",
    ...RevisionSchema
  });

  server.addSchema({
    $id: "JobDefinition",
    ...JobDefinitionSchema
  });

  server.addSchema({
    $id: "JobResults",
    ...JobResultsSchema
  });
}
