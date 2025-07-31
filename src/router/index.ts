import { Db } from "mongodb";
import fastify from "fastify";
import middie from "@fastify/middie";
import swagger from "@fastify/swagger";

import { getConfig } from "../config/index.js";
import { authMiddleware } from "./middleware/index.js";
import { CollectionsNames } from "../definitions/collection.js";
import { setupDeploymentsRoutes, setupVaultRoutes } from "./setup/index.js";

import { addSchemas } from "./schema/index.schema.js";

import { Collections } from "../types/index.js";

import pkg from "../../package.json" assert { type: "json" };

export async function startDeploymentManagerApi(db: Db) {
  const server = fastify({ logger: true });

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
    },
  });

  addSchemas(server);

  await server.register(middie);

  server.decorateReply("locals", {
    getter() {
      return {
        db: CollectionsNames.reduce((collections, name) => {
          // @ts-expect-error collections are type safe
          collections[name] = db.collection(name);
          return collections;
        }, {} as Collections),
      };
    },
  });

  server.get("/documentation/json", async (req, res) => {
    res.header("Content-Type", "application/json");
    return server.swagger();
  });

  server.addHook("onRequest", authMiddleware);

  setupDeploymentsRoutes(server);
  setupVaultRoutes(server);
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
