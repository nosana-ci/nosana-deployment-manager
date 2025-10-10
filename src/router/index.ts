import { Db } from "mongodb";
import fastify from "fastify";
import middie from "@fastify/middie";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUI from "@fastify/swagger-ui";

import { getConfig } from "../config/index.js";
import { authMiddleware } from "./middleware/index.js";
import { nosanaLogo, swaggerGenerateAuth } from "./ui/index.js";
import { CollectionsNames } from "../definitions/collection.js";
import { setupDeploymentsRoutes, setupJobsRoutes, setupVaultRoutes } from "./setup/index.js";

import { addSchemas } from "./schema/index.schema.js";

import { Collections } from "../types/index.js";

import pkg from "../../package.json" assert { type: "json" };

export async function startDeploymentManagerApi(db: Db) {
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
      onComplete: swaggerGenerateAuth,
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

  server.get("/documentation/json", async (req, res) => {
    res.header("Content-Type", "application/json");
    return server.swagger();
  });

  server.addHook("onRequest", authMiddleware);

  setupDeploymentsRoutes(server);
  setupJobsRoutes(server);
  setupVaultRoutes(server);

  server.get("/", { logLevel: "silent", schema: { hide: true } }, (_req, res) =>
    res.status(200).send()
  );
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
}
