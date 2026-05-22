#!/usr/bin/env node

import type { FastifyInstance } from "fastify";

import { initKit } from "./kit/index.js";
import { initStats, registerWorkerMetrics } from "./stats/index.js";
import { setConfig } from "./config/index.js";
import { startDeploymentManagerApi } from "./router/index.js";
import { startHealthServer } from "./health/server.js";
import {
  closeDeploymentsConnection,
  createDeploymentsConnection,
} from "./connection/deployments.js";
import {
  startDeploymentManagerListeners,
  type DeploymentManagerListenersHandle,
} from "./listeners/index.js";
import { createConfidentialJobDefinition } from "./definitions/confidential.jobdefinition.js";
import { getAppMode, shouldRunApi, shouldRunWorker } from "./config/mode.js";
import { createMetrics } from "./metrics/index.js";

const SHUTDOWN_TIMEOUT_MS = 130_000; // 120s task drain + 10s margin

const mode = getAppMode();
console.log(`[deployment-manager] starting in mode "${mode}"`);

initStats();
const metrics = createMetrics(mode);
if (metrics.worker) {
  registerWorkerMetrics(metrics.worker);
}

if (shouldRunWorker(mode)) {
  const kit = initKit();
  const confidentialIpfsPin = await kit.ipfs.pin(createConfidentialJobDefinition());
  setConfig("confidential_ipfs_pin", confidentialIpfsPin);
}

const dbClient = await createDeploymentsConnection(mode);

if (!dbClient) {
  throw new Error("Failed to connect to the database");
}

let listenersHandle: DeploymentManagerListenersHandle | null = null;
let apiServer: FastifyInstance | null = null;
let healthServer: FastifyInstance | null = null;

if (shouldRunWorker(mode)) {
  listenersHandle = await startDeploymentManagerListeners(dbClient);
}

if (shouldRunApi(mode)) {
  apiServer = await startDeploymentManagerApi(dbClient, mode, metrics);
} else if (shouldRunWorker(mode)) {
  // Worker without api: spin up a tiny HTTP server for the k8s liveness probe,
  // ops-side `/stats` access, and Prometheus scrape endpoint.
  healthServer = await startHealthServer(mode, metrics);
}

let shuttingDown = false;

const shutdown = async (signal: NodeJS.Signals) => {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`[deployment-manager] shutting down gracefully (signal=${signal})`);

  const forceExit = setTimeout(() => {
    console.warn("[deployment-manager] shutdown timed out, forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    // 1. Stop accepting new HTTP traffic and drain in-flight requests.
    if (apiServer) {
      await apiServer.close();
      console.log("[deployment-manager] stopped api server");
    }
    if (healthServer) {
      await healthServer.close();
      console.log("[deployment-manager] stopped health server");
    }

    // 2. Stop the worker subsystems: tasks polling + worker_threads drain,
    //    then change streams + Solana monitor.
    if (listenersHandle) {
      await listenersHandle.stop();
      console.log("[deployment-manager] stopped task scheduling");
      console.log("[deployment-manager] closed change streams");
    }

    // 3. Close the MongoDB connection last.
    await closeDeploymentsConnection();
    console.log("[deployment-manager] shutdown complete");
  } catch (err) {
    console.error("[deployment-manager] error during shutdown", err);
  } finally {
    clearTimeout(forceExit);
    process.exit(0);
  }
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
