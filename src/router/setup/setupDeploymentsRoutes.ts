import { FastifyInstance } from "fastify";

import {
  getDeploymentMiddleware,
  validateActiveDeploymentMiddleware,
} from "../middleware/index.js";

import { routes } from "../routes/index.js";

import { routeSchemas } from "../schema/index.schema.js";
import { API_PREFIX } from "../../definitions/api.js";

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
    API_PREFIX,
    {
      schema: DeploymentsHandlerSchema,
    },
    deploymentsHandler
  );

  server.get(
    `${API_PREFIX}/:deployment`,
    {
      schema: DeploymentByIdSchema,
      preHandler: [getDeploymentMiddleware],
    },
    getDeploymentByIdHandler
  );

  server.get(
    `${API_PREFIX}/:deployment/tasks`,
    {
      schema: GetDeploymentScheduledTasksSchema,
      preHandler: [getDeploymentMiddleware, validateActiveDeploymentMiddleware],
    },
    deploymentGetScheduledTasksHandler
  );

  server.get(
    `${API_PREFIX}/:deployment/header`,
    {
      schema: GetDeploymentHeaderSchema,
      preHandler: [getDeploymentMiddleware],
    },
    deploymentGetHeaderHandler
  )

  // POST
  server.post(
    `${API_PREFIX}/create`,
    {
      schema: DeploymentCreateSchema,
    },
    deploymentCreateHandler
  );

  server.post(
    `${API_PREFIX}/:deployment/create-revision`,
    {
      schema: DeploymentCreateRevisionSchema,
      preHandler: [getDeploymentMiddleware, validateActiveDeploymentMiddleware],
    },
    deploymentCreateRevisionHandler
  );

  server.post(
    `${API_PREFIX}/:deployment/start`,
    {
      schema: DeploymentStartSchema,
      preHandler: [getDeploymentMiddleware],
    },
    deploymentStartHandler
  );

  server.post(
    `${API_PREFIX}/:deployment/stop`,
    {
      schema: DeploymentStopSchema,
      preHandler: [getDeploymentMiddleware, validateActiveDeploymentMiddleware],
    },
    deploymentStopHandler
  );

  // PATCH
  server.post(
    `${API_PREFIX}/:deployment/archive`,
    {
      schema: DeploymentArchiveSchema,
      preHandler: [getDeploymentMiddleware, validateActiveDeploymentMiddleware],
    },
    deploymentArchiveHandler
  );

  server.patch(
    `${API_PREFIX}/:deployment/update-active-revision`,
    {
      schema: DeploymentUpdateActiveRevisionSchema,
      preHandler: [getDeploymentMiddleware, validateActiveDeploymentMiddleware],
    },
    deploymentUpdateActiveRevisionHandler
  );

  server.patch(
    `${API_PREFIX}/:deployment/update-replica-count`,
    {
      schema: DeploymentUpdateReplicaCountSchema,
      preHandler: [getDeploymentMiddleware, validateActiveDeploymentMiddleware],
    },
    deploymentUpdateReplicaCountHandler
  );

  server.patch(
    `${API_PREFIX}/:deployment/update-schedule`,
    {
      schema: DeploymentUpdateScheduleSchema,
      preHandler: [getDeploymentMiddleware, validateActiveDeploymentMiddleware],
    },
    deploymentUpdateScheduleHandler
  );

  server.patch(
    `${API_PREFIX}/:deployment/update-timeout`,
    {
      schema: DeploymentUpdateTimeoutSchema,
      preHandler: [getDeploymentMiddleware, validateActiveDeploymentMiddleware],
    },
    deploymentUpdateTimeoutHandler
  );
}
