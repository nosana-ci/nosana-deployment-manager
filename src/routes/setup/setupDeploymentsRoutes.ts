import { Express } from "express";

import {
  getDeploymentMiddleware,
  validateActiveDeploymentMiddleware,
} from "../middleware/index.js";

import {
  deploymentIdHandler,
  deploymentsHandler,
} from "../routes/get/index.js";
import {
  deploymentCreateHandler,
  deploymentStartHandler,
  deploymentStopHandler,
} from "../routes/post/index.js";
import {
  deploymentArchiveHandler,
  deploymentUpdateReplicaCountHandler,
  deploymentUpdateTimeoutHandler,
} from "../routes/patch/index.js";

export function setupDeploymentsRoutes(app: Express) {
  // GET
  app.get("/api/deployments", deploymentsHandler);
  app.get(
    "/api/deployment/:deployment",
    getDeploymentMiddleware,
    deploymentIdHandler
  );
  // POST
  app.post("/api/deployment/create", deploymentCreateHandler);
  app.post(
    "/api/deployment/:deployment/start",
    getDeploymentMiddleware,
    validateActiveDeploymentMiddleware,
    deploymentStartHandler
  );
  app.post(
    "/api/deployment/:deployment/stop",
    getDeploymentMiddleware,
    validateActiveDeploymentMiddleware,
    deploymentStopHandler
  );
  // PATCH
  app.patch(
    "/api/deployment/:deployment/archive",
    getDeploymentMiddleware,
    validateActiveDeploymentMiddleware,
    deploymentArchiveHandler
  );
  app.patch(
    "/api/deployment/:deployment/update-replica-count",
    getDeploymentMiddleware,
    validateActiveDeploymentMiddleware,
    deploymentUpdateReplicaCountHandler
  );
  app.patch(
    "/api/deployment/:deployment/update-timeout",
    getDeploymentMiddleware,
    validateActiveDeploymentMiddleware,
    deploymentUpdateTimeoutHandler
  );
}
