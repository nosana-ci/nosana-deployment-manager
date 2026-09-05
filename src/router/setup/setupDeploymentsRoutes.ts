import { FastifyInstance } from "fastify";

import {
  defaultEmptyBodyMiddleware,
  getDeploymentMiddleware,
  validateActiveDeploymentMiddleware,
} from "../middleware/index.js";

import { routes } from "../routes/index.js";
import {
  skipSwaggerValidation,
  jobDefinitionValidation,
  deploymentCreateValidation,
} from "../validators/index.js";

import { routeSchemas } from "../schema/index.schema.js";
import { API_PREFIX } from "../../definitions/api.js";

const {
  get: {
    deploymentGetScheduledTasksHandler,
    deploymentGetHeaderHandler,
    getDeploymentByIdHandler,
    deploymentsHandler,
    deploymentJobByIdHandler,
    getDeploymentJobsHandler,
    getDeploymentRevisionsHandler,
    getDeploymentSshKeysHandler,
    getDeploymentEventsHandler,
    streamDeploymentEventsHandler,
  },
  post: {
    deploymentCreateHandler,
    deploymentCreateRevisionHandler,
    deploymentDuplicateHandler,
    deploymentStartHandler,
    deploymentStopHandler,
  },
  patch: {
    deploymentArchiveHandler,
    deploymentUpdateActiveRevisionHandler,
    deploymentUpdateMarketHandler,
    deploymentUpdateNameHandler,
    deploymentUpdateReplicaCountHandler,
    deploymentUpdateScheduleHandler,
    deploymentUpdateSshKeysHandler,
    deploymentUpdateStartupTimeoutHandler,
    deploymentUpdateTimeoutHandler,
  },
  delete: {
    deploymentDeleteHandler,
  },
} = routes;

const {
  get: {
    DeploymentsHandlerSchema,
    DeploymentByIdSchema,
    GetDeploymentScheduledTasksSchema,
    GetDeploymentHeaderSchema,
    DeploymentJobByIdSchema,
    GetDeploymentJobsSchema,
    GetDeploymentRevisionsSchema,
    GetDeploymentSshKeysSchema,
    GetDeploymentEventsSchema,
    StreamDeploymentEventsSchema,
  },
  post: {
    DeploymentCreateSchema,
    DeploymentCreateRevisionSchema,
    DeploymentDuplicateSchema,
    DeploymentStartSchema,
    DeploymentStopSchema,
  },
  patch: {
    DeploymentArchiveSchema,
    DeploymentUpdateActiveRevisionSchema,
    DeploymentUpdateMarketSchema,
    DeploymentUpdateNameSchema,
    DeploymentUpdateReplicaCountSchema,
    DeploymentUpdateScheduleSchema,
    DeploymentUpdateSshKeysSchema,
    DeploymentUpdateStartupTimeoutSchema,
    DeploymentUpdateTimeoutSchema,
  },
  delete: { DeploymentDeleteSchema },
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

  server.get(`${API_PREFIX}/:deployment/jobs/:job`,
    {
      schema: DeploymentJobByIdSchema,
      preHandler: [getDeploymentMiddleware],
      serializerCompiler: skipSwaggerValidation,
    },
    deploymentJobByIdHandler
  );

  server.get(
    `${API_PREFIX}/:deployment/jobs`,
    {
      schema: GetDeploymentJobsSchema,
      preHandler: [getDeploymentMiddleware],
    },
    getDeploymentJobsHandler
  );

  server.get(
    `${API_PREFIX}/:deployment/revisions`,
    {
      schema: GetDeploymentRevisionsSchema,
      preHandler: [getDeploymentMiddleware],
    },
    getDeploymentRevisionsHandler
  );

  server.get(
    `${API_PREFIX}/:deployment/events`,
    {
      schema: GetDeploymentEventsSchema,
      preHandler: [getDeploymentMiddleware],
    },
    getDeploymentEventsHandler
  );

  server.get(
    `${API_PREFIX}/:deployment/stream`,
    {
      schema: StreamDeploymentEventsSchema,
      preHandler: [getDeploymentMiddleware],
      // A HEAD request would hijack and never answer.
      exposeHeadRoute: false,
    },
    streamDeploymentEventsHandler
  );

  server.get(
    `${API_PREFIX}/:deployment/ssh-keys`,
    {
      schema: GetDeploymentSshKeysSchema,
      preHandler: [getDeploymentMiddleware],
    },
    getDeploymentSshKeysHandler
  );

  // POST
  server.post(
    `${API_PREFIX}/create`,
    {
      schema: DeploymentCreateSchema,
      validatorCompiler: deploymentCreateValidation,
    },
    deploymentCreateHandler
  );

  server.post(
    `${API_PREFIX}/:deployment/create-revision`,
    {
      schema: DeploymentCreateRevisionSchema,
      preHandler: [getDeploymentMiddleware, validateActiveDeploymentMiddleware],
      validatorCompiler: jobDefinitionValidation,
    },
    deploymentCreateRevisionHandler
  );

  // The source may be ARCHIVED: duplicating reads it, never modifies it.
  // Every body field is optional, so the body itself may be omitted.
  server.post(
    `${API_PREFIX}/:deployment/duplicate`,
    {
      schema: DeploymentDuplicateSchema,
      preValidation: [defaultEmptyBodyMiddleware],
      preHandler: [getDeploymentMiddleware],
    },
    deploymentDuplicateHandler
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

  // DELETE
  server.delete(
    `${API_PREFIX}/:deployment`,
    {
      schema: DeploymentDeleteSchema,
      preHandler: [getDeploymentMiddleware],
    },
    deploymentDeleteHandler
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
    `${API_PREFIX}/:deployment/update-name`,
    {
      schema: DeploymentUpdateNameSchema,
      preHandler: [getDeploymentMiddleware],
    },
    deploymentUpdateNameHandler
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
    `${API_PREFIX}/:deployment/update-market`,
    {
      schema: DeploymentUpdateMarketSchema,
      preHandler: [getDeploymentMiddleware, validateActiveDeploymentMiddleware],
    },
    deploymentUpdateMarketHandler
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
    `${API_PREFIX}/:deployment/update-ssh-keys`,
    {
      schema: DeploymentUpdateSshKeysSchema,
      preHandler: [getDeploymentMiddleware, validateActiveDeploymentMiddleware],
    },
    deploymentUpdateSshKeysHandler
  );

  server.patch(
    `${API_PREFIX}/:deployment/update-timeout`,
    {
      schema: DeploymentUpdateTimeoutSchema,
      preHandler: [getDeploymentMiddleware, validateActiveDeploymentMiddleware],
    },
    deploymentUpdateTimeoutHandler
  );

  server.patch(
    `${API_PREFIX}/:deployment/update-startup-timeout`,
    {
      schema: DeploymentUpdateStartupTimeoutSchema,
      preHandler: [getDeploymentMiddleware, validateActiveDeploymentMiddleware],
    },
    deploymentUpdateStartupTimeoutHandler
  );
}
