import { FastifyInstance } from "fastify";

import {
  getDeploymentMiddleware,
  validateActiveDeploymentMiddleware,
} from "../middleware/index.js";

import { routes } from "../routes/index.js";

import { routeSchemas } from "../schema/index.schema.js";

const {
  get: {
    deploymentGetScheduledTasksHandler,
    deploymentGetHeaderHandler,
    getDeploymentByIdHandler,
    deploymentsHandler,
  },
  post: {
    deploymentCreateHandler,
    deploymentCreateRevisionHandler,
    deploymentStartHandler,
    deploymentStopHandler,
  },
  patch: {
    deploymentArchiveHandler,
    deploymentUpdateActiveRevisionHandler,
    deploymentUpdateReplicaCountHandler,
    deploymentUpdateScheduleHandler,
    deploymentUpdateTimeoutHandler,
  },
} = routes;

const {
  get: {
    DeploymentsHandlerSchema,
    DeploymentByIdSchema,
    GetDeploymentScheduledTasksSchema,
    GetDeploymentHeaderSchema
  },
  post: { DeploymentCreateSchema, DeploymentCreateRevisionSchema, DeploymentStartSchema, DeploymentStopSchema },
  patch: {
    DeploymentArchiveSchema,
    DeploymentUpdateActiveRevisionSchema,
    DeploymentUpdateReplicaCountSchema,
    DeploymentUpdateScheduleSchema,
    DeploymentUpdateTimeoutSchema,
  },
} = routeSchemas;

export function setupDeploymentsRoutes(server: FastifyInstance) {
  // GET
  server.get(
    "/api/deployments",
    {
      schema: DeploymentsHandlerSchema,
    },
    deploymentsHandler
  );

  server.get(
    "/api/deployment/:deployment",
    {
      schema: DeploymentByIdSchema,
      preHandler: [getDeploymentMiddleware],
    },
    getDeploymentByIdHandler
  );

  server.get(
    "/api/deployment/:deployment/tasks",
    {
      schema: GetDeploymentScheduledTasksSchema,
      preHandler: [getDeploymentMiddleware, validateActiveDeploymentMiddleware],
    },
    deploymentGetScheduledTasksHandler
  );

  server.get(
    "/api/deployment/:deployment/header",
    {
      schema: GetDeploymentHeaderSchema,
      preHandler: [getDeploymentMiddleware],
    },
    deploymentGetHeaderHandler
  )

  // POST
  server.post(
    "/api/deployment/create",
    {
      schema: DeploymentCreateSchema,
    },
    deploymentCreateHandler
  );

  server.post(
    "/api/deployment/:deployment/create-revision",
    {
      schema: DeploymentCreateRevisionSchema,
      preHandler: [getDeploymentMiddleware, validateActiveDeploymentMiddleware],
    },
    deploymentCreateRevisionHandler
  );

  server.post(
    "/api/deployment/:deployment/start",
    {
      schema: DeploymentStartSchema,
      preHandler: [getDeploymentMiddleware],
    },
    deploymentStartHandler
  );

  server.post(
    "/api/deployment/:deployment/stop",
    {
      schema: DeploymentStopSchema,
      preHandler: [getDeploymentMiddleware, validateActiveDeploymentMiddleware],
    },
    deploymentStopHandler
  );

  // PATCH
  server.patch(
    "/api/deployment/:deployment/archive",
    {
      schema: DeploymentArchiveSchema,
      preHandler: [getDeploymentMiddleware, validateActiveDeploymentMiddleware],
    },
    deploymentArchiveHandler
  );

  server.patch(
    "/api/deployment/:deployment/update-active-revision",
    {
      schema: DeploymentUpdateActiveRevisionSchema,
      preHandler: [getDeploymentMiddleware, validateActiveDeploymentMiddleware],
    },
    deploymentUpdateActiveRevisionHandler
  );

  server.patch(
    "/api/deployment/:deployment/update-replica-count",
    {
      schema: DeploymentUpdateReplicaCountSchema,
      preHandler: [getDeploymentMiddleware, validateActiveDeploymentMiddleware],
    },
    deploymentUpdateReplicaCountHandler
  );

  server.patch(
    "/api/deployment/:deployment/update-schedule",
    {
      schema: DeploymentUpdateScheduleSchema,
      preHandler: [getDeploymentMiddleware, validateActiveDeploymentMiddleware],
    },
    deploymentUpdateScheduleHandler
  );

  server.patch(
    "/api/deployment/:deployment/update-timeout",
    {
      schema: DeploymentUpdateTimeoutSchema,
      preHandler: [getDeploymentMiddleware, validateActiveDeploymentMiddleware],
    },
    deploymentUpdateTimeoutHandler
  );
}
