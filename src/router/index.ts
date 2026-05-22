import { Db } from "mongodb";
import fastify, { FastifyInstance } from "fastify";
import middie from "@fastify/middie";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUI from "@fastify/swagger-ui";

import { getConfig } from "../config/index.js";
import { authMiddleware, authJobHostMiddleware } from "./middleware/index.js";
import { nosanaLogo } from "./ui/index.js";
import { CollectionsNames } from "../definitions/collection.js";
import { setupDeploymentsRoutes, setupJobsRoutes, setupStatsRoutes, setupVaultRoutes } from "./setup/index.js";
import { AppMode } from "../config/mode.js";

import { addSchemas } from "./schema/index.schema.js";

import { Collections } from "../types/index.js";

import pkg from "../../package.json" with { type: "json" };

import type { MetricsHandle } from "../metrics/index.js";

export async function startDeploymentManagerApi(db: Db, mode: AppMode, metricsHandle: MetricsHandle): Promise<FastifyInstance> {
  const server = fastify({
    logger: true, ajv: {
      customOptions: {
        coerceTypes: false
      }
    }
  });

  server.addContentTypeParser('application/json', { parseAs: 'string' }, function (req, body, done) {
    if (!req) return done(new Error('No request object'));
    try {
      const json = JSON.parse(body as string);
      done(null, json);
    } catch (err) {
      // @ts-expect-error expected type
      done(err, undefined);
    }
  });

  // Register metrics instrumentation and the /metrics scrape endpoint early,
  // before other plugins, so all routes are covered by the HTTP hook.
  if (metricsHandle.http) {
    await server.register(metricsHandle.http.plugin);
  }
  await server.register(metricsHandle.mountRoute);

  await server.register(swagger, {
    refResolver: {
      buildLocalReference(json, _baseUri, _fragment, i) {
        if (!json.title && json.$id) json.title = json.$id;
        if (!json.$id) return `def-${i}`;
        return `${json.$id}`;
      },
    },
    openapi: {
      openapi: "3.0.0",
      info: {
        title: pkg.name,
        version: pkg.version,
      },
      components: {
        securitySchemes: {
          Authorization: {
            type: "apiKey",
            in: "header",
            name: "Authorization",
          },
        },
      },
    },
  });

  await server.register(swaggerUI, {
    routePrefix: "/documentation/swagger",
    logLevel: "silent",
    logo: {
      type: "image/svg+xml",
      content: nosanaLogo,
      href: "",
    },
    uiConfig: {
      deepLinking: true,
      persistAuthorization: true,
    },
  });

  addSchemas(server);

  await server.register(cors, {
    origin: true
  });

  await server.register(middie);

  const dbCollections = CollectionsNames.reduce((collections, name) => {
    // @ts-expect-error collections are type safe
    collections[name] = db.collection(name);
    return collections;
  }, {} as Collections);

  server.decorateReply("locals", {
    getter() {
      if (!this._locals) {
        this._locals = {
          db: dbCollections,
        };
      }
      return this._locals as { db: Collections };
    },
    setter(value) {
      if (!this._locals) {
        this._locals = {
          db: dbCollections,
        };
      }
      Object.assign(this._locals, value);
    },
  });

  // Open routes
  server.get("/documentation/json", {
    logLevel: "silent",
    schema: { hide: true }
  }, async (_req, res) => {
    res.header("Content-Type", "application/json");
    return server.swagger();
  });

  server.get("/", { logLevel: "silent", schema: { hide: true } }, (_req, res) =>
    res.status(200).send()
  );

  server.get("/health", { logLevel: "silent", schema: { hide: true } }, (_req, res) =>
    res.status(200).send({
      status: "healthy",
      mode,
      timestamp: new Date().toISOString(),
    })
  );

  // Job host authenticated routes
  server.register(async (scoped) => {
    scoped.addHook("onRequest", authJobHostMiddleware);
    setupJobsRoutes(scoped);
  });

  // Protected routes
  server.register(async (scoped) => {
    scoped.addHook("onRequest", authMiddleware);
    setupDeploymentsRoutes(scoped);
    setupVaultRoutes(scoped);
  });

  setupStatsRoutes(server);

  try {
    await server.ready();
    await server.listen({
      host: "0.0.0.0",
      port: getConfig().deployment_manager_port,
    });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }

  return server;
}
